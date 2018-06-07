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

import {Injectable} from "@angular/core";
import {HttpClient, HttpHeaders, HttpParams} from "@angular/common/http";
import * as hmacSHA256 from "crypto-js/hmac-sha256";
import * as hex from "crypto-js/enc-hex";
import {catchError, map} from "rxjs/operators";
import {ToastrService} from "./toastr.service";
import {Observable} from "rxjs";
import {throwError} from "rxjs/internal/observable/throwError";
import {TradeOptions} from "./binance.service";
import {Observer} from "rxjs/Observer";

const API_ROOT = "/proxy/binance";
const STREAM_ROOT = "wss://stream.binance.com:9443";

export enum Side {
    BUY = "BUY",
    SELL = "SELL",
}

export enum TimeInForce {
    GTC = "GTC",
}

export enum OrderType {
    LIMIT = "LIMIT",
    MARKET = "MARKET",
}

export enum OrderStatus {
    NEW = "NEW",
    PARTIALLY_FILLED = "PARTIALLY_FILLED",
    FILLED = "FILLED",
    CANCELED = "CANCELED",
    PENDING_CANCEL = "PENDING_CANCEL",
    REJECTED = "REJECTED",
    EXPIRED = "EXPIRED",
}

export interface SellOrderOptions {
    trade_id: string;
    symbol: string;
    type: OrderType;
    quantity: number;
    price?: number | string;
    timeInForce?: TimeInForce;
    newClientOrderId?: string;
}

export interface BuyOrderOptions {
    symbol: string;
    type: OrderType;
    quantity: number;
    price?: number | string;
    timeInForce?: TimeInForce;
    newClientOrderId?: string;
}

@Injectable()
export class BinanceApiService {

    private _apiKey: string = null;

    private _apiSecret: string = null;

    constructor(private http: HttpClient,
                private toastr: ToastrService) {
    }

    set apiKey(key: string) {
        this._apiKey = key;
    }

    set apiSecret(secret: string) {
        this._apiSecret = secret;
    }

    private get(path: string, params: HttpParams = null,
                authenticated: boolean = false): Observable<Object> {
        const url = `${API_ROOT}${path}`;

        if (params == null) {
            params = new HttpParams();
        }

        let headers = new HttpHeaders();

        if (authenticated) {
            const timestamp = new Date().getTime();
            params = params.set("timestamp", `${timestamp}`);

            let hmacDigest = hmacSHA256(params.toString(), this._apiSecret);
            params = params.set("signature", hex.stringify(hmacDigest));

            headers = headers.append("X-MBX-APIKEY", this._apiKey);
        }

        return this.http.get<Object>(url, {
            headers: headers,
            params: params,
        });
    }

    private post(path: string, options?: {
        params?: HttpParams;
        headers?: HttpHeaders;
    }, body: any = null) {
        let headers = options.headers || new HttpHeaders();
        let params = options.params || new HttpParams();
        return this.http.post(path, body, {
            params: params,
            headers: headers,
        }).pipe(catchError((error) => {
            if (error.error instanceof ErrorEvent) {
                console.log("A client side error occurred: ");
                console.log(error);
                return throwError(error);
            } else {
                return throwError(error);
            }
        }));
    }

    private delete(path: string, params: HttpParams = null): Observable<any> {
        return this.http.delete(path, {
            params: params,
        });
    }

    getAccountInfo(): Observable<AccountInfo> {
        const endpoint = "/api/v3/account";
        return this.get(endpoint, null, true)
                .pipe(map((raw: RawRestAccountInfo) => {
                    return AccountInfo.fromRest(raw);
                }));
    }

    getExchangeInfo(): Observable<ExchangeInfo> {
        const endpoint = "/api/v1/exchangeInfo";
        return this.get(endpoint, null, false).pipe(map((info: RestExchangeInfoResponse) => {
            return ExchangeInfo.fromRest(info);
        }));
    }

    getPriceTicker(symbol: string): Observable<PriceTicker> {
        const endpoint = "/api/v3/ticker/price";
        const params = new HttpParams().set("symbol", symbol);
        return this.get(endpoint, params, false).pipe(
                map((r: RestTickerPriceResponse) => {
                    return buildTickerFromRest(r);
                }));
    }

    getBookTicker(symbol: string): Observable<BookTicker> {
        const endpoint = "/api/v3/ticker/bookTicker";
        const params = new HttpParams().set("symbol", symbol);
        return this.get(endpoint, params, false).pipe(
                map((r: RestBookTicker): BookTicker => {
                    return {
                        symbol: r.symbol,
                        bidPrice: +r.bidPrice,
                        bidQty: +r.bidQty,
                        askPrice: +r.askPrice,
                        askQty: +r.askQty,
                    };
                })
        );
    }

    postBuyOrder(options: BuyOrderOptions, body: TradeOptions = null): Observable<BuyOrderResponse> {
        const endpoint = "/api/binance/buy";
        let params = new HttpParams()
                .set("symbol", options.symbol)
                .set("type", options.type)
                .set("quantity", `${options.quantity}`);
        if (options.timeInForce != null) {
            params = params.set("timeInForce", options.timeInForce);
        }
        if (options.price != null) {
            params = params.set("price", `${options.price}`);
        }
        if (options.newClientOrderId) {
            params = params.set("newClientOrderId", options.newClientOrderId);
        }
        return <Observable<BuyOrderResponse>>this.post(endpoint, {
            params: params,
        }, body);
    }

    cancelSellOrder(tradeId: string): Observable<CancelOrderResponse> {
        const endpoint = "/api/binance/sell";
        let params = new HttpParams().set("trade_id", tradeId);
        return this.delete(endpoint, params);
    }

    cancelBuy(tradeId: string): Observable<CancelOrderResponse> {
        const endpoint = "/api/binance/buy";
        let params = new HttpParams()
                .set("trade_id", tradeId);
        return this.delete(endpoint, params);
    }

    openStream(path: string): Observable<any> {
        const url = `${STREAM_ROOT}${path}`;
        return makeWebSocketObservable(url);
    }

    openMultiStream(streams: string[]): Observable<MultiStreamMessage> {
        const path = "/stream?streams=" + streams.join("/");
        return this.openStream(path).pipe(map((event: MultiStreamFrame) => {
            return new MultiStreamMessage(event);
        }));
    }

    openUserDataStream(): Observable<UserStreamEvent> {
        return Observable.create((observer) => {
            let ws: WebSocket = null;
            let closeRequested = false;
            const openWebSocket = () => {
                console.log(`Opening user stream.`);
                let opened = false;

                ws = new WebSocket(`ws://${window.location.host}/ws/binance/userStream`);

                ws.onmessage = (event) => {
                    observer.next(JSON.parse(event.data));
                };

                ws.onopen = (event) => {
                    opened = true;
                    this.toastr.info("Connected to Binance user stream.", null, {
                        timeOut: 3000,
                        preventDuplicates: true,
                    });
                };

                ws.onerror = (event) => {
                    console.log(`User stream websocket error: ${JSON.stringify(event)}`);
                };

                ws.onclose = () => {
                    console.log(`User stream closed: closeRequested=${closeRequested}`);
                    if (!closeRequested) {
                        this.toastr.error("User data stream closed. Reconnecting.", null, {
                            timeOut: 3000,
                            closeButton: true,
                            preventDuplicates: true,
                            preventOpenDuplicates: true,
                        });
                        if (opened) {
                            openWebSocket();
                        } else {
                            setTimeout(() => {
                                openWebSocket();
                            }, 3000);
                        }
                    }
                };
            };

            openWebSocket();

            return () => {
                closeRequested = true;
                if (ws != null) {
                    ws.close();
                }
            };

        }).pipe(map((r: any) => {
            const event: UserStreamEvent = {
                event: r.e,
                data: r,
            };
            if (event.event === "outboundAccountInfo") {
                event.accountInfo = AccountInfo.fromStream(event.data);
            } else if (event.event === "executionReport") {
                event.executionReport = ExecutionReport.fromStream(event.data);
            }
            return event;
        }));
    }

}

interface RestTickerPriceResponse {
    symbol: string;
    price: string;
}

/**
 * Cancel order response object. Needs no translation.
 */
export interface CancelOrderResponse {
    symbol: string;
    origClientOrder: string;
    orderId: number;
    clientOrderId: string;
}

export interface BuyOrderResponse {
    trade_id: string;
}

export interface UserStreamEvent {
    event: string;
    data: any;

    accountInfo?: AccountInfo;
    executionReport?: ExecutionReport;
}

export interface StreamBalance {
    a: string; // Asset.
    f: string; // Free amount.
    l: string; // Locked amount.
}

export interface RestBalance {
    asset: string;
    free: string;
    locked: string;
}

export interface StreamExecutionReport {
    e: string;
    E: number;
    s: string;
    c: string;
    S: Side; // Side.
    o: OrderType;
    f: string;
    q: string;
    p: string;
    P: string;
    F: string;
    C: string; // Original client order ID.
    x: string;
    X: string;
    r: string;
    i: number;
    l: string;
    z: string;
    L: string;
    n: string;
    N: string
    T: number;
    t: number;
    w: boolean;
    M: boolean;
}

export class ExecutionReport {

    eventTime: Date = null;

    symbol: string = null;

    clientOrderId: string = null;

    side: Side = null;

    orderType: OrderType = null;

    timeInForce: string = null;

    quantity: number = null;

    price: number = null;

    originalClientOrderId: string = null;

    executionType: string = null;

    orderStatus: OrderStatus = null;

    rejectReason: string = null;

    orderId: number = null;

    lastExecutedQuantity: number = null;

    cumulativeFilledQuantity: number = null;

    lastExecutedPrice: number = null;

    commissionAmount: number = null;

    commissionAsset: string = null;

    transactionTime: Date = null;

    tradeId: number = null;

    static fromStream(data: StreamExecutionReport): ExecutionReport {
        let r = new ExecutionReport();
        r.eventTime = new Date(data.E);
        r.symbol = data.s;
        r.clientOrderId = data.c;
        r.side = data.S;
        r.orderType = data.o;
        r.timeInForce = data.f;
        r.quantity = +data.q;
        r.price = +data.p;
        r.originalClientOrderId = data.C;
        r.executionType = data.x;
        r.orderStatus = <OrderStatus>data.X;
        r.rejectReason = data.r;
        r.orderId = data.i;
        r.lastExecutedQuantity = +data.l;
        r.cumulativeFilledQuantity = +data.z;
        r.lastExecutedPrice = +data.L;
        r.commissionAmount = +data.n;
        r.commissionAsset = data.N;
        r.transactionTime = new Date(data.T);
        r.tradeId = data.t;

        return r;
    }

}

export class Balance {

    asset: string;

    free: number;

    locked: number;

    static fromRest(raw: RestBalance): Balance {
        let balance = new Balance();
        balance.asset = raw.asset;
        balance.free = +raw.free;
        balance.locked = +raw.locked;
        return balance;
    }

    static fromStream(raw: StreamBalance): Balance {
        let balance = new Balance();
        balance.asset = raw.a;
        balance.free = +raw.f;
        balance.locked = +raw.l;
        return balance;
    }
}

export interface RawRestAccountInfo {
    makeCommission: number;
    takerCommission: number;
    buyerCommission: number;
    sellerCommission: number;
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    updateTime: number;
    balances: RestBalance[];
}

export interface RawStreamAccountInfo {
    B: StreamBalance[];
}

export class AccountInfo {

    balances: Balance[] = null;

    static fromRest(raw: RawRestAccountInfo): AccountInfo {
        let accountInfo = new AccountInfo();
        accountInfo.balances = raw.balances.map((b): Balance => {
            return Balance.fromRest(b);
        });
        return accountInfo;
    }

    static fromStream(raw: RawStreamAccountInfo): AccountInfo {
        let accountInfo = new AccountInfo();
        accountInfo.balances = raw.B.map((b): Balance => {
            return Balance.fromStream(b);
        });
        return accountInfo;
    }
}

export interface RestSymbolInfo {
    symbol: string;
    status: string;
    baseAsset: string;
    baseAssetPrecision: number;
    quoteAsset: string;
    quotePrecision: number;
    filters: any[];
}

interface RestExchangeInfoResponse {
    symbols: RestSymbolInfo[];
}

export class SymbolInfo {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: any[];

    minNotional: number;
    minQuantity: number;
    stepSize: number;
    tickSize: number;

    private init() {
        this.minNotional = this.getMinNotional();
        this.minQuantity = this.getMinQuantity();
        this.stepSize = this.getStepSize();
        this.tickSize = this.getTickSize();
    }

    getMinNotional(): number {
        if (this.filters) {
            for (let f of this.filters) {
                if (f.minNotional) {
                    return +f.minNotional;
                }
            }
        }
        return null;
    }

    getMinQuantity(): number {
        if (this.filters) {
            for (let f of this.filters) {
                if (f.filterType && f.filterType == "LOT_SIZE") {
                    return +f.minQty;
                }
            }
        }
        return null;
    }

    getStepSize(): number {
        if (this.filters) {
            for (let f of this.filters) {
                if (f.filterType && f.filterType == "LOT_SIZE") {
                    return +f.stepSize;
                }
            }
        }
        return null;
    }

    getTickSize(): number {
        if (this.filters) {
            for (let f of this.filters) {
                if (f.filterType && f.filterType == "PRICE_FILTER") {
                    return +f.tickSize;
                }
            }
        }
        return null;
    }

    static fromRest(rest: RestSymbolInfo): SymbolInfo {
        let info = new SymbolInfo();
        Object.assign(info, rest);
        info.init();
        return info;
    }
}

export class ExchangeInfo {

    symbols: SymbolInfo[] = [];

    static fromRest(rest: RestExchangeInfoResponse): ExchangeInfo {
        let info = new ExchangeInfo();
        for (let symbol of rest.symbols) {
            info.symbols.push(SymbolInfo.fromRest(symbol));
        }
        return info;
    }
}

interface MultiStreamFrame {
    stream: string;
    data: any;
}

export interface StreamAggTrade {
    e: string; // Event type
    E: number; // Event time
    s: string; // Symbol
    a: number; // Aggregate trade ID
    p: string; // Price
    q: string; // Quantity
    f: number; // First trade ID
    l: number; // Last trade ID
    T: number; // Trade time
    m: boolean; // Is buyer the maker
    M: boolean; // Ignore
}

export interface AggTrade {
    symbol: string;
    price: number;
    quantity: number;
}

interface StreamTicker {
    e: string; // Event type.
    s: string; // Symbol.
    c: string; // Current day close price (last price).
}

export interface PriceTicker {
    symbol: string;
    price: number;
}

export interface RestBookTicker {
    symbol: string;
    bidPrice: string;
    bidQty: string;
    askPrice: string;
    askQty: string;
}

export interface BookTicker {
    symbol: string;
    bidPrice: number;
    bidQty: number;
    askPrice: number;
    askQty: number;
}

interface StreamDepth {
    lastUpdateId: number;
    bids: any[];
    asks: any[];
}

interface RestDepth extends StreamDepth {
}

export interface Depth {
    symbol: string;
    lastUpdateId: number;
    bids: { price: number, quantity: number }[];
    asks: { price: number, quantity: number }[];
}

export function makeDepthFromStream(symbol: string, raw: StreamDepth | RestDepth): Depth {
    let bids = raw.bids.map((bid) => {
        return {
            price: +bid[0],
            quantity: +bid[1],
        };
    });
    let asks = raw.asks.map((ask) => {
        return {
            price: +ask[0],
            quantity: +ask[1],
        };
    });
    return {
        symbol: symbol.toUpperCase(),
        lastUpdateId: raw.lastUpdateId,
        bids: bids,
        asks: asks,
    };
}

export class MultiStreamMessage {

    stream: string = null;

    data: any = null;

    symbol: any = null;

    streamType: string = null;

    constructor(private frame: MultiStreamFrame) {
        this.stream = frame.stream;
        this.data = frame.data;

        const parts = frame.stream.split("@");
        if (parts.length > 1) {
            this.symbol = parts[0].toUpperCase();
            this.streamType = parts[1];
        }
    }

    getAggTrade(): AggTrade {
        return buildAggTradeFromStream(this.data);
    }

    getTicker(): PriceTicker {
        return buildTickerFromStream(this.data);
    }

    getDepth(): Depth {
        return makeDepthFromStream(this.symbol, this.data);
    }
}

export function buildAggTradeFromStream(raw: StreamAggTrade): AggTrade {
    return {
        symbol: raw.s.toUpperCase(),
        price: +raw.p,
        quantity: +raw.q,
    };
}

export function buildTickerFromStream(raw: StreamTicker): PriceTicker {
    return {
        symbol: raw.s.toUpperCase(),
        price: +raw.c,
    };
}

function buildTickerFromRest(r: RestTickerPriceResponse): PriceTicker {
    return {
        symbol: r.symbol.toUpperCase(),
        price: +r.price,
    };
}

export function makeWebSocketObservable(url: string): Observable<any> {
    return Observable.create((observer: Observer<any>) => {

        let ws: WebSocket = null;
        let closeRequested: boolean = false;

        const openWebSocket = () => {
            console.log("Connecting to websocket: " + url);
            ws = new WebSocket(url);

            ws.onmessage = (event) => {
                observer.next(JSON.parse(event.data));
            };

            ws.onerror = (event) => {
                console.log("websocket error:");
                console.log(event);
                observer.error(event);
            };

            ws.onclose = () => {
                if (!closeRequested) {
                    openWebSocket();
                }
            };
        };

        openWebSocket();

        return () => {
            closeRequested = true;
            if (ws != null) {
                ws.close();
            }
        };

    });

}
