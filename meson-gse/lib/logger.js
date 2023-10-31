// meson-gse - Library for gnome-shell extensions
// Copyright (C) 2019-2021 Philippe Troin (F-i-f on Github)
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import GLib from 'gi://GLib';
import System from 'system';

export class Logger {
    constructor(title, metadata, package_version) {
	this._title = title;
	this._metadata = metadata;
	this._package_version = package_version;

	this._first_log = true;
	this._debug = false;
    }

    get_version() {
	return this._metadata['version']+' / git '+this._metadata['vcs_revision'];
    }

    log(text) {
	if (this._first_log) {
	    this._first_log = false;
	    let msg = 'version ' + this.get_version();
	    let gnomeShellVersion = this._package_version;
	    if (gnomeShellVersion != undefined) {
		msg += ' on Gnome-Shell ' + gnomeShellVersion;
	    }
	    let gjsVersion = System.version;
	    if (gjsVersion != undefined) {
		let gjsVersionMajor = Math.floor(gjsVersion / 10000);
		let gjsVersionMinor = Math.floor((gjsVersion % 10000) / 100);
		let gjsVersionPatch = gjsVersion % 100;
		msg +=( ' / gjs ' + gjsVersionMajor
			+ '.' +gjsVersionMinor
			+ '.' +gjsVersionPatch
			+ ' ('+gjsVersion+')');
	    }
	    let sessionType = GLib.getenv('XDG_SESSION_TYPE');
	    if (sessionType != undefined) {
		msg += ' / ' + sessionType;
	    }
	  this.log(msg);
	}
	console.log(''+this._title+': '+text);
    }

    log_debug(text) {
	if (this._debug) {
	    this.log(text);
	}
    }

    set_debug(debug) {
	this._debug = debug;
    }

    get_debug() {
	return this._debug;
    }
};
