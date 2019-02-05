// Soft-brightness - Control the display's brightness via an alpha channel.
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
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.convenience;
const Utils = Me.imports.utils;
const Indicator = imports.ui.status.brightness.Indicator;
const AggregateMenu = imports.ui.main.panel.statusArea.aggregateMenu;

let debug = null;
let enabled = null;
let settings = null;
let debugSettingChangedConnection = null;
let modifiedIndicator = null;

function log(what) {
    global.log('Soft-Brightness: '+what);
}

function log_debug(what) {
    if (debug) {
	log(what);
    }
}

let ModifiedIndicator = new Lang.Class({
    Name: 'ModifiedBrightnessIndicator',
    Extends: Indicator,

    _init() {
	this.parent();

	this._monitorManager = null;
	this._displayConfigProxy = null;
	this._monitorNames = null;
	this._overlays = null;

	this._monitorsChangedConnection = null;
	this._minBrightnessSettingChangedConnection = null;
	this._currentBrightnessSettingChangedConnection = null;
	this._monitorsSettingChangedConnection = null;
	this._builtinMonitorSettingChangedConnection = null;
	this._useBacklightSettingChangedConnection = null;
    },

    _swapMenu(oldIndicator, newIndicator) {
	let menuItems = AggregateMenu.menu._getMenuItems();
	let menuIndex = null;
	for (let i = 0; i < menuItems.length; i++) {
	    if (oldIndicator.menu == menuItems[i]) {
		menuIndex = i;
		break;
	    }
	}
	if (menuIndex == null) {
	    log('_swapMenu(): Cannot find brightness indicator');
	    return false;
	}
	log_debug('_swapMenu(): Replacing brightness menu item at index '+menuIndex);
	menuItems.splice(menuIndex, 1);
	oldIndicator._proxy.run_dispose();
	oldIndicator.menu.destroy();
	AggregateMenu.menu.addMenuItem(newIndicator.menu, menuIndex);
	AggregateMenu._brightness = newIndicator;
	return true;
    },

    _enable() {
	log_debug('_enable()');

	if (! this._swapMenu(AggregateMenu._brightness, this)) {
	    return;
	}

	this._monitorManager = Meta.MonitorManager.get();
	Utils.newDisplayConfig(Lang.bind(this, function(proxy, error) {
	    if (error) {
		log("newDisplayConfig() callback: Cannot get Display Config: " + error);
		return;
	    }
	    log_debug('newDisplayConfig() callback');
	    this._displayConfigProxy = proxy;
	    this._on_monitors_change();
	}));

	this._monitorsChangedConnection = Main.layoutManager.connect('monitors-changed', this._on_monitors_change.bind(this));
	this._minBrightnessSettingChangedConnection = settings.connect('changed::min-brightness', Lang.bind(this, function() { this._on_brightness_change(false); }));
	this._currentBrightnessSettingChangedConnection = settings.connect('changed::current-brightness', Lang.bind(this, function() { this._on_brightness_change(false); }));
	this._monitorsSettingChangedConnection = settings.connect('changed::monitors', this._on_monitors_change.bind(this));
	this._builtinMonitorSettingChangedConnection = settings.connect('changed::builtin-monitor', this._on_monitors_change.bind(this));
	this._useBacklightSettingChangedConnection = settings.connect('changed::use-backlight', this._on_use_backlight_change.bind(this));

	// If we use the backlight and the Brightness proxy is null, it's still connecting and we'll get a _sync later.
	if (! settings.get_boolean('use-backlight') || this._proxy.Brightness != null) {
	    let curBrightness = this._getBrightnessLevel();
	    this._sliderChanged(this._slider, curBrightness);
	    this._slider.setValue(curBrightness);
	}
    },

    _disable() {
	log_debug('_disable()');

	let standardIndicator = new imports.ui.status.brightness.Indicator();
	this._swapMenu(this, standardIndicator);

	Main.layoutManager.disconnect(this._monitorsChangedConnection);
	settings.disconnect(this._minBrightnessSettingChangedConnection);
	settings.disconnect(this._currentBrightnessSettingChangedConnection);
	settings.disconnect(this._monitorsSettingChangedConnection);
	settings.disconnect(this._builtinMonitorSettingChangedConnection);
	settings.disconnect(this._useBacklightSettingChangedConnection);
	this._hideOverlays();
    },

    _sliderChanged(slider, value) {
	log_debug("_sliderChanged(slide, "+value+")");
	this._storeBrightnessLevel(value);
    },

    _sync() {
	log_debug("_sync()");
	this._on_brightness_change(false);
	this._slider.setValue(this._getBrightnessLevel());
    },

    _hideOverlays() {
	if (this._overlays != null) {
	    log_debug("drop overlays, count="+this._overlays.length);
	    for (let i=0; i < this._overlays.length; ++i) {
		Main.uiGroup.remove_actor(this._overlays[i]);
	    }
	    this._overlays = null;
	}
    },

    _showOverlays(opacity, force) {
	log_debug('_showOverlays('+opacity+', '+force+')');
	if (this._overlays == null || force) {
	    let enabledMonitors = settings.get_string('monitors');
	    let monitors;
	    log_debug('_showOverlays(): enabledMonitors="'+enabledMonitors+'"');
	    if (enabledMonitors == "all") {
		monitors = Main.layoutManager.monitors;
	    } else if (enabledMonitors == "built-in" || enabledMonitors == "external") {
		if (this._monitorNames == null) {
		    log_debug("_showOverlays(): skipping run as _monitorNames hasn't been set yet.");
		    return;
		}
		let builtinMonitorName = settings.get_string('builtin-monitor');
		log_debug('_showOverlays(): builtinMonitorName="'+builtinMonitorName+'"');
		if (builtinMonitorName == "" || builtinMonitorName == null) {
		    builtinMonitorName = this._monitorNames[Main.layoutManager.primaryIndex];
		    log_debug('_showOverlays(): no builtin monitor, setting to "'+builtinMonitorName+'" and skipping run');
		    settings.set_string('builtin-monitor', builtinMonitorName);
		    return;
		}
		monitors = [];
		for (let i=0; i < Main.layoutManager.monitors.length; ++i) {
		    if (    (enabledMonitors == "built-in" && this._monitorNames[i] == builtinMonitorName )
			 || (enabledMonitors == "external" && this._monitorNames[i] != builtinMonitorName ) ) {
			monitors.push(Main.layoutManager.monitors[i]);
		    }
		}
	    } else {
		log("_showOverlays(): Unhandled \"monitors\" setting = "+enabledMonitors);
		return;
	    }
	    if (force) {
		this._hideOverlays();
	    }
	    this._overlays = [];
	    for (let i=0; i < monitors.length; ++i) {
		let monitor = monitors[i];
		log_debug('Create overlay #'+i+': '+monitor.width+'x'+monitor.height+'@'+monitor.x+','+monitor.y);
		let overlay = new St.Label({
		    style_class: 'brightness-overlay',
		    text: "",
		});
		overlay.set_position(monitor.x, monitor.y);
		overlay.set_width(monitor.width);
		overlay.set_height(monitor.height);
		overlay.set_z_position(0.00001);
		Main.uiGroup.add_actor(overlay);
		this._overlays.push(overlay);
	    }
	}

	for (let i=0; i < this._overlays.length; ++i) {
	    log_debug('_showOverlay(): set opacity '+opacity+' on overlay #'+i);
	    this._overlays[i].opacity = opacity;
	}
    },

    _storeBrightnessLevel(value) {
	if (settings.get_boolean('use-backlight') && this._proxy.Brightness >= 0) {
	    let convertedBrightness = Math.min(100, Math.round(value * 100.0)+1);
	    log_debug('_storeBrightnessLevel('+value+') by proxy -> '+convertedBrightness);
	    this._proxy.Brightness = convertedBrightness;
	} else {
	    log_debug('_storeBrightnessLevel('+value+') by setting');
	    settings.set_double('current-brightness', value);
	}
    },

    _getBrightnessLevel() {
	let brightness = this._proxy.Brightness;
	if (settings.get_boolean('use-backlight') && brightness != brightness >= 0) {
	    let convertedBrightness = brightness / 100.0;
	    log_debug('_getBrightnessLevel() by proxy = '+convertedBrightness+' <- '+brightness);
	    return convertedBrightness;
	} else {
	    brightness = settings.get_double('current-brightness');
	    log_debug('_getBrightnessLevel() by setting = '+brightness);
	    return brightness;
	}
    },

    _on_brightness_change(force) {
	let curBrightness = this._getBrightnessLevel();
	let minBrightness = settings.get_double('min-brightness');

	log_debug("_on_brightness_change: current-brightness="+curBrightness+", min-brightness="+minBrightness);
	if (curBrightness < minBrightness) {
	    curBrightness = minBrightness;
	    if (! settings.get_boolean('use-backlight')) {
		this._slider.setValue(curBrightness);
	    }
	    this._storeBrightnessLevel(minBrightness);
	    return;
	}
	if (curBrightness >= 1) {
	    this._hideOverlays();
	} else {
	    let opacity = (1-curBrightness)*255;
	    log_debug("_on_brightness_change: opacity="+opacity);
	    this._showOverlays(opacity, force);
	}
    },

    _on_monitors_change() {
	if (this._displayConfigProxy == null) {
	    log_debug("_on_monitors_change(): skipping run as the proxy hasn't been set up yet.");
	    return;
	}
	log_debug("_on_monitors_change()");
	Utils.getMonitorConfig(this._displayConfigProxy, Lang.bind(this, function(result, error) {
	    if (error) {
		log("_on_monitors_change(): cannot get Monitor Config: "+error);
		return;
	    }
	    let monitorNames = [];
	    for (let i=0; i < result.length; ++i) {
		let [monitorName, connectorName] = result[i];
		let monitorIndex = this._monitorManager.get_monitor_for_connector(connectorName);
		log_debug('_on_monitors_change(): monitor="'+monitorName+'", connector="'+connectorName+'", index='+monitorIndex);
		if (monitorIndex >= 0) {
		    monitorNames[monitorIndex] = monitorName;
		}
	    }
	    this._monitorNames = monitorNames;
	    this._on_brightness_change(true);
	}));
    },

    _on_use_backlight_change() {
	log_debug('_on_use_backlight_change()');
	if (settings.get_boolean('use-backlight')) {
	    this._storeBrightnessLevel(settings.get_double('current-brightness'));
	} else if (this._proxy.Brightness != null && this._proxy.Brightness >= 0) {
	    this._storeBrightnessLevel(this._proxy.Brightness / 100.0);
	}
    }

});

function on_debug_change() {
    debug = settings.get_boolean('debug');
    log('debug = '+debug);
}

function init() {
    log_debug('init()');
    Convenience.initTranslations();
}

function enable() {
    if (enabled) {
	log_debug('enable(), session mode = '+Main.sessionMode.currentMode+", skipping as already enabled");
    } else {
	settings = Convenience.getSettings();
	debugSettingChangedConnection = settings.connect('changed::debug', on_debug_change);
	debug = settings.get_boolean('debug');
	log_debug('enable(), session mode = '+Main.sessionMode.currentMode);
	modifiedIndicator = new ModifiedIndicator();
	modifiedIndicator._enable();

	enabled = true;
	log_debug('Extension enabled');
    }
}

function disable() {
    if (Main.sessionMode.currentMode == 'unlock-dialog') {
	log_debug('disable() skipped as session-mode = unlock-dialog');
    } else if (enabled) {
	log_debug('disable(), session mode = '+Main.sessionMode.currentMode);
	settings.disconnect(debugSettingChangedConnection);
	modifiedIndicator._disable();
	modifiedIndicator = null;
	settings.run_dispose();
	enabled = false;
	log_debug('Extension disabled');
    } else {
	log('disabled() called when not enabled');
    }
}
