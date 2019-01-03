// Copyright (C) 2018 Cranky Kernel
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

package server

import (
	"fmt"
	"github.com/gorilla/mux"
	_ "github.com/mattn/go-sqlite3"
	"gitlab.com/crankykernel/cryptotrader/binance"
	"gitlab.com/crankykernel/maker/binanceex"
	"gitlab.com/crankykernel/maker/context"
	"gitlab.com/crankykernel/maker/db"
	"gitlab.com/crankykernel/maker/log"
	"gitlab.com/crankykernel/maker/tradeservice"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

var ServerFlags struct {
	Host           string
	Port           int16
	ConfigFilename string
	LogFilename    string
	NoLog          bool
	OpenBrowser    bool
}

func ServerMain() {

	log.SetLevel(log.LogLevelDebug)

	if !ServerFlags.NoLog {
		log.AddHook(log.NewFileOutputHook(ServerFlags.LogFilename))
	}

	if ServerFlags.Host != "127.0.0.1" {
		log.Fatal("Hosts other than 127.0.0.1 not allowed yet.")
	}

	applicationContext := &context.ApplicationContext{}
	applicationContext.BinanceStreamManager = binanceex.NewBinanceStreamManager()

	db.DbOpen()

	tradeService := tradeservice.NewTradeService(applicationContext.BinanceStreamManager)
	applicationContext.TradeService = tradeService

	restoreTrades(tradeService)

	applicationContext.BinanceUserDataStream = binanceex.NewBinanceUserDataStream()
	userStreamChannel := applicationContext.BinanceUserDataStream.Subscribe()
	go applicationContext.BinanceUserDataStream.Run()

	go func() {
		for {
			select {
			case event := <-userStreamChannel:
				switch event.EventType {
				case binanceex.EventTypeExecutionReport:
					if err := db.DbSaveBinanceRawExecutionReport(event.EventTime, event.Raw); err != nil {
						log.Println(err)
					}
					tradeService.OnExecutionReport(event)
				}
			}
		}
	}()

	router := mux.NewRouter()

	router.HandleFunc("/api/config", configHandler).Methods("GET")

	router.HandleFunc("/api/binance/buy", PostBuyHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/buy", deleteBuyHandler(tradeService)).Methods("DELETE")
	router.HandleFunc("/api/binance/sell", DeleteSellHandler(tradeService)).Methods("DELETE")

	// Set/change stop-loss on a trade.
	router.HandleFunc("/api/binance/trade/{tradeId}/stopLoss",
		updateTradeStopLossSettingsHandler(tradeService)).Methods("POST")

	router.HandleFunc("/api/binance/trade/{tradeId}/trailingProfit",
		updateTradeTrailingProfitSettingsHandler(tradeService)).Methods("POST")

	// Limit sell at percent.
	router.HandleFunc("/api/binance/trade/{tradeId}/limitSellByPercent",
		limitSellByPercentHandler(tradeService)).Methods("POST")

	// Limit sell at price.
	router.HandleFunc("/api/binance/trade/{tradeId}/limitSellByPrice",
		limitSellByPriceHandler(tradeService)).Methods("POST")

	router.HandleFunc("/api/binance/trade/{tradeId}/marketSell",
		marketSellHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/archive",
		archiveTradeHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/abandon",
		abandonTradeHandler(tradeService)).Methods("POST")

	router.HandleFunc("/api/trade/query", queryTradesHandler).
		Methods("GET")
	router.HandleFunc("/api/trade/{tradeId}",
		getTradeHandler).Methods("GET")

	router.HandleFunc("/api/binance/account/test",
		BinanceTestHandler).Methods("GET")
	router.HandleFunc("/api/binance/config",
		SaveBinanceConfigHandler).Methods("POST")
	router.HandleFunc("/api/config/preferences",
		SavePreferencesHandler).Methods("POST");
	binanceApiProxyHandler := http.StripPrefix("/proxy/binance",
		binance.NewBinanceApiProxyHandler())
	router.PathPrefix("/proxy/binance").Handler(binanceApiProxyHandler)

	router.PathPrefix("/ws").Handler(NewUserWebSocketHandler(applicationContext))

	router.PathPrefix("/").HandlerFunc(staticAssetHandler())

	listenHostPort := fmt.Sprintf("%s:%d", ServerFlags.Host, ServerFlags.Port)
	log.Printf("Starting server on %s.", listenHostPort)
	wg := sync.WaitGroup{}
	wg.Add(1)
	go func() {
		err := http.ListenAndServe(listenHostPort, router)
		if err != nil {
			log.Fatal("Failed to start server: ", err)
		}
	}()

	if ServerFlags.OpenBrowser {
		url := fmt.Sprintf("http://%s:%d", ServerFlags.Host, ServerFlags.Port)
		log.Info("Attempting to start browser.")
		go func() {
			if runtime.GOOS == "linux" {
				c := exec.Command("xdg-open", url)
				c.Run()
			} else if runtime.GOOS == "darwin" {
				c := exec.Command("open", url)
				c.Run()
			} else if runtime.GOOS == "windows" {
				cmd := "url.dll,FileProtocolHandler"
				runDll32 := filepath.Join(os.Getenv("SYSTEMROOT"), "System32",
					"rundll32.exe")
				c := exec.Command(runDll32, cmd, url)
				if err := c.Run(); err != nil {
					log.WithError(err).WithFields(log.Fields{
						"os": "windows",
					}).Errorf("Failed to start browser.")
				}
			}
		}()
	}

	wg.Wait()
}