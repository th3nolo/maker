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

import {Component, OnInit} from '@angular/core';
import {BinanceService} from './binance.service';
import {LoginService} from "./login.service";
import {MakerApiService} from "./maker-api.service";
import {MakerSocketService} from "./maker-socket.service";

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {

    ticker: { [key: string]: number } = {};

    constructor(public binance: BinanceService,
                public makerApi: MakerApiService,
                public loginService: LoginService,
                public makerSocket: MakerSocketService) {
    }

    ngOnInit() {
        this.binance.isReady$.subscribe(() => {
            this.binance.subscribeToTicker("BTCUSDT").subscribe((ticker) => {
                this.ticker[ticker.symbol] = ticker.price;
            });
        });
    }

    logout() {
        this.loginService.logout();
    }
}
