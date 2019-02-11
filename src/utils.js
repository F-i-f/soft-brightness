// Soft-brightness - Control the display's brightness via an alpha channel.
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

const Lang = imports.lang;
const Gio = imports.gi.Gio;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

let cachedDisplayConfigProxy = null;

function getDisplayConfigProxy() {
    if (cachedDisplayConfigProxy == null) {
	let xml = null;
	let file = Gio.File.new_for_path(Me.path + '/dbus-interfaces/org.gnome.Mutter.DisplayConfig.xml');
	try {
	    let [ok, bytes] = file.load_contents(null);
	    if (ok) {
		xml = imports.byteArray.toString(bytes);
	    }
	} catch(e) {
	    log('failed to load DisplayConfig interface XML');
	    return;
	}
	cachedDisplayConfigProxy = Gio.DBusProxy.makeProxyWrapper(xml);

    }
    return cachedDisplayConfigProxy;
}

function newDisplayConfig(callback) {
    let displayConfigProxy = getDisplayConfigProxy();
    return new displayConfigProxy(Gio.DBus.session,
				  'org.gnome.Mutter.DisplayConfig',
				  '/org/gnome/Mutter/DisplayConfig',
				  callback);
}

function getMonitorConfig(displayConfigProxy, callback) {
    displayConfigProxy.GetResourcesRemote(Lang.bind(this, function(result) {
	if (result.length <= 2) {
	    callback(null, "Cannot get DisplayConfig: No outputs in GetResources()");
	} else {
	    let monitors = [];
	    for (let i=0; i < result[2].length; ++i) {
		let output = result[2][i];
		if (output.length <= 7) {
		    callback(null, "Cannot get DisplayConfig: No properties on output #"+i);
		    return;
		}
		let props = output[7];
		let display_name = props['display-name'].get_string()[0];
		let connector_name = output[4];
		if (! display_name || display_name == "") {
		    let display_name = "Monitor on output "+connector_name;
		}
		monitors.push([display_name, connector_name]);
	    }
	    callback(monitors, null);
	}
    }));
}
