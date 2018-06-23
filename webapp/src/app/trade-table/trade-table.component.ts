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

import {Component, Input, OnInit} from "@angular/core";
import {
    MakerService,
    TradeMap,
    TradeState,
    TradeStatus
} from "../maker.service";
import {Logger, LoggerService} from "../logger.service";
import {ToastrService} from "../toastr.service";
import {AggTrade} from '../binance-api.service';
import {Trade} from '../trade';

@Component({
    selector: "app-trade-table",
    templateUrl: "./trade-table.component.html",
    styleUrls: ["./trade-table.component.scss"]
})
export class TradeTableComponent implements OnInit {

    TradeStatus = TradeStatus;

    trades: AppTradeState[] = [];

    private logger: Logger = null;

    @Input() showArchiveButtons: boolean = true;

    @Input() showTradeButtons: boolean = false;

    constructor(public maker: MakerService,
                private toastr: ToastrService,
                logger: LoggerService) {
        this.logger = logger.getLogger("TradeTableComponent");
    }

    ngOnInit() {
    }

    /**
     * Called by parent component to update the list of trades.
     *
     * This variation takes a map of trades keyed by ID.
     */
    onTradeMapUpdate(tradeMap: TradeMap) {
        const trades: AppTradeState[] = [];
        for (const tradeId of Object.keys(tradeMap)) {
            trades.push(toAppTradeState(tradeMap[tradeId]));
        }
        this.trades = this.sortTrades(trades);
    }

    onTradesUpdate(trades: TradeState[]) {
        this.trades = this.sortTrades(trades.map((trade: TradeState): AppTradeState => {
            return toAppTradeState(trade);
        }));
    }

    private sortTrades(trades: AppTradeState[]): AppTradeState[] {
        return trades.sort((a, b) => {
            return new Date(b.OpenTime).getTime() -
                    new Date(a.OpenTime).getTime();
        });
    }

    onAggTrade(aggTrade: AggTrade) {
        for (const trade of this.trades) {
            if (trade.Symbol === aggTrade.symbol) {
                switch (trade.Status) {
                    case TradeStatus.DONE:
                    case TradeStatus.FAILED:
                    case TradeStatus.CANCELED:
                    case TradeStatus.ABANDONED:
                        break;
                    default:
                        trade.LastPrice = aggTrade.price;
                        Trade.updateProfit(trade, aggTrade.price);
                        trade.__rowClassName = getRowClass(trade);
                }
            }
        }
    }

    archive(trade: TradeState) {
        this.maker.archiveTrade(trade);
    }

    archiveAllClosed() {
        for (const trade of this.trades) {
            switch (trade.Status) {
                case TradeStatus.FAILED:
                case TradeStatus.CANCELED:
                case TradeStatus.DONE:
                    this.archive(trade);
                    break;
            }
        }
    }

    archiveCanceledFailed() {
        for (const trade of this.trades) {
            switch (trade.Status) {
                case TradeStatus.FAILED:
                case TradeStatus.CANCELED:
                    this.archive(trade);
                    break;
            }
        }
    }

}

export interface AppTradeState extends TradeState {
    __rowClassName?: string;
    __canArchive?: boolean;
    __canSell?: boolean;
    __canAbandon?: boolean;
    __isOpen?: boolean;

    /** The percent off from the purchase price. */
    buyPercentOffsetPercent?: number;
}

export function toAppTradeState(trade: TradeState): AppTradeState {
    const appTradeState = <AppTradeState>trade;
    appTradeState.__rowClassName = getRowClass(trade);
    appTradeState.__canArchive = canArchive(trade);
    appTradeState.__canSell = canSell(trade);
    appTradeState.__canAbandon = canAbandon(trade);
    appTradeState.__isOpen = Trade.isOpen(trade);
    return appTradeState;
}

export function canArchive(trade: AppTradeState): boolean {
    switch (trade.Status) {
        case TradeStatus.DONE:
        case TradeStatus.CANCELED:
        case TradeStatus.FAILED:
        case TradeStatus.ABANDONED:
            return true;
        default:
            return false;
    }
}

export function canSell(trade: AppTradeState): boolean {
    switch (trade.Status) {
        case TradeStatus.WATCHING:
        case TradeStatus.PENDING_SELL:
            return true;
        default:
            return false;
    }
}

export function canAbandon(trade: AppTradeState): boolean {
    switch (trade.Status) {
        case TradeStatus.DONE:
        case TradeStatus.CANCELED:
        case TradeStatus.FAILED:
        case TradeStatus.ABANDONED:
            return false;
        default:
            return true;
    }
}

export function getRowClass(trade: AppTradeState): string {
    switch (trade.Status) {
        case TradeStatus.CANCELED:
        case TradeStatus.FAILED:
        case TradeStatus.ABANDONED:
            return "table-secondary";
        case TradeStatus.DONE:
            if (trade.ProfitPercent > 0) {
                return "bg-success";
            }
            return "bg-warning";
        case TradeStatus.NEW:
        case TradeStatus.PENDING_BUY:
            return "table-info";
        default:
            if (trade.ProfitPercent > 0) {
                return "table-success";
            }
            return "table-warning";
    }
}
