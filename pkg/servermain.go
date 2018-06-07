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

package pkg

import (
	"fmt"
	"github.com/gorilla/mux"
	"net/http"
	"github.com/crankykernel/cryptotrader/binance"
	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"
	"github.com/crankykernel/maker/pkg/log"
	"github.com/crankykernel/maker/pkg/config"
	"runtime"
	"os/exec"
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

func getBinanceRestClient() *binance.RestClient {
	restClient := binance.NewAuthenticatedClient(
		config.GetString("binance.api.key"),
		config.GetString("binance.api.secret"))
	return restClient
}

type ApplicationContext struct {
	TradeService         *TradeService
	BinanceStreamManager *BinanceStreamManager
	OpenBrowser          bool
}

func ServerMain() {

	log.SetLevel(log.LogLevelDebug)

	if !ServerFlags.NoLog {
		log.AddHook(log.NewFileOutputHook(ServerFlags.LogFilename))
	}

	if ServerFlags.Host != "127.0.0.1" {
		log.Fatal("Hosts other than 127.0.0.1 not allowed yet.")
	}

	applicationContext := &ApplicationContext{}
	applicationContext.BinanceStreamManager = NewBinanceStreamManager()

	DbOpen()

	tradeService := NewTradeService(applicationContext)
	applicationContext.TradeService = tradeService

	tradeStates, err := DbRestoreTradeState()
	if err != nil {
		log.Fatalf("error: failed to restore trade state: %v", err)
	}
	for _, state := range (tradeStates) {
		tradeService.RestoreTrade(NewTradeWithState(state))
	}
	log.Printf("Restored %d trade states.", len(tradeService.TradesByClientID))

	binanceUserDataStream := NewBinanceUserDataStream()
	userStreamChannel := binanceUserDataStream.Subscribe()
	go binanceUserDataStream.Run()

	go func() {
		for {
			select {
			case event := <-userStreamChannel:
				switch event.EventType {
				case EventTypeExecutionReport:
					if err := DbSaveBinanceRawExecutionReport(event); err != nil {
						log.Println(err)
					}
					tradeService.OnExecutionReport(event)
				}
			}
		}
	}()

	router := mux.NewRouter()

	router.HandleFunc("/api/config", configHandler).Methods("GET")

	router.HandleFunc("/api/binance/buy", postBuyHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/buy", deleteBuyHandler(tradeService)).Methods("DELETE")
	router.HandleFunc("/api/binance/sell", postSellHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/sell", deleteSellHandler(tradeService)).Methods("DELETE")

	router.HandleFunc("/api/binance/trade/{tradeId}/stopLoss",
		updateTradeStopLossSettingsHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/trailingStop",
		updateTradeTrailingStopSettingsHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/limitSell",
		limitSellHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/marketSell",
		marketSellHandler(tradeService)).Methods("POST")
	router.HandleFunc("/api/binance/trade/{tradeId}/archive",
		archiveTradeHandler(tradeService)).Methods("POST")

	router.HandleFunc("/api/binance/account/test",
		binanceTestHandler).Methods("GET")
	router.HandleFunc("/api/binance/config",
		saveBinanceConfigHandler).Methods("POST")
	router.HandleFunc("/api/config/preferences",
		savePreferencesHandler).Methods("POST");
	binanceApiProxyHandler := http.StripPrefix("/proxy/binance",
		binance.NewBinanceApiProxyHandler())
	router.PathPrefix("/proxy/binance").Handler(binanceApiProxyHandler)

	router.HandleFunc("/ws/binance/userStream", func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("error: failed to upgrade user stream websocket: %v", err)
		}
		userStreamChannel := binanceUserDataStream.Subscribe()
		defer binanceUserDataStream.Unsubscribe(userStreamChannel)

		for {
			select {
			case message := <-userStreamChannel:
				ws.WriteMessage(websocket.TextMessage, message.Raw)
			}
		}
	})

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
				c := exec.Command("start", url)
				c.Run()
			}
		}()
	}

	wg.Wait()
}
