// meson-gse - Library for gnome-shell extensions
// Copyright (C) 2019 Philippe Troin <phil@fifi.org>
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

const Lang = imports.lang;

const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();

var Logger = new Lang.Class({
    Name: 'MesonGseLogger',

    _init: function(title) {
	this._first_log = true;
	this._title = title;
	this._debug = false;
    },

    log: function(text) {
	if (this._first_log) {
	    this._first_log = false;
	    this.log('version '+Me.metadata['version']+' / git '+Me.metadata['vcs_revision']);
	}
	global.log(''+this._title+': '+text);
    },

    log_debug: function(text) {
	if (this._debug) {
	    this.log(text);
	}
    },

    set_debug: function(debug) {
	this._debug = debug;
    },

    get_debug: function() {
	return this._debug;
    }
});
