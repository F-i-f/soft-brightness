// meson-gse - Library for gnome-shell extensions
// Copyright (C) 2019 Philippe Troin (F-i-f on Github)
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

const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();

const Logger = class MesonGseLogger {
    constructor(title) {
	this._first_log = true;
	this._title = title;
	this._debug = false;
    }

    get_version() {
	return Me.metadata['version']+' / git '+Me.metadata['vcs_revision'];
    }

    log(text) {
	if (this._first_log) {
	    this._first_log = false;
	    this.log('version '+this.get_version());
	}
	global.log(''+this._title+': '+text);
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
