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

const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.convenience;
const Brightness = imports.ui.main.panel.statusArea.aggregateMenu._brightness;
const BrightnessSlider = Brightness._slider;

let debug = null;
let enabled = null;
let settings = null;
let overlays = null;
let debugSettingChangedConnection = null;
let minBrightnessSettingChangedConnection = null;
let currentBrightnessSettingChangedConnection = null;
let useBacklightSettingChangedConnection = null;
let monitorsSettingChangedConnection = null;
let monitorsChangedConnection = null;
let brightnessIndicatorOriginalSync = null;
let sliderChangedBacklightConnection = null;
let sliderChangedBacklightCode = null;
let sliderChangedConnection = null;

function log(what) {
    global.log('Soft-Brightness: '+what);
}

function log_debug(what) {
    if (debug) {
	log(what);
    }
}

function hideOverlays() {
    if (overlays != null) {
	log_debug("drop overlays");
	for (let i=0; i < overlays.length; ++i) {
	    Main.uiGroup.remove_actor(overlays[i]);
	}
	overlays = null;
    }
}

function showOverlays(opacity) {
    if (overlays == null) {
	let monitorConfig = settings.get_string('monitors');
	let monitors;
	log_debug('showOverlays(): monitorConfig='+monitorConfig);
	if (monitorConfig == "All") {
	    monitors = Main.layoutManager.monitors;
	} else if (monitorConfig == "Built-in") {
	    monitors = [Main.layoutManager.primaryMonitor];
	} else if (monitorConfig == "External") {
	    monitors = [];
	    for (let i=0; i < Main.layoutManager.monitors.length; ++i) {
		if (Main.layoutManager.monitors[i] != Main.layoutManager.primaryMonitor) {
		    monitors.push(Main.layoutManager.monitors[i]);
		}
	    }
	} else {
	    log("showOverlays(): Unhandled \"monitors\" setting = "+monitorConfig);
	    return;
	}
	overlays = [];
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
	    overlays.push(overlay);
	}
    }

    for (let i=0; i < overlays.length; ++i) {
	overlays[i].opacity = opacity;
    }
}

function storeBrightnessLevel(value) {
    if (settings.get_boolean('use-backlight') && Brightness._proxy.Brightness >= 0) {
	let convertedBrightness = Math.min(100, Math.round(value * 100.0)+1);
	log_debug('storeBrightnessLevel('+value+') by proxy -> '+convertedBrightness);
	Brightness._proxy.Brightness = convertedBrightness;
    } else {
	log_debug('storeBrightnessLevel('+value+') by setting');
	settings.set_double('current-brightness', value);
    }
}

function getBrightnessLevel() {
    let brightness = Brightness._proxy.Brightness;
    if (settings.get_boolean('use-backlight') && brightness != brightness >= 0) {
	let convertedBrightness = brightness / 100.0;
	log_debug('getBrightnessLevel() by proxy = '+convertedBrightness+' <- '+brightness);
	return convertedBrightness;
    } else {
	brightness = settings.get_double('current-brightness');
	log_debug('getBrightnessLevel() by setting = '+brightness);
	return brightness;
    }
}

function sliderChanged(slider, value) {
    log_debug("sliderChanged, value="+value);
    storeBrightnessLevel(value);
}

function on_debug_change() {
    debug = settings.get_boolean('debug');
    log('debug = '+debug);
}

function on_brightness_change() {
    let curBrightness = getBrightnessLevel();
    let minBrightness = settings.get_double('min-brightness');

    log_debug("on_brightness_change: current-brightness="+curBrightness+", min-brightness="+minBrightness);
    if (curBrightness < minBrightness) {
	curBrightness = minBrightness;
	if (! settings.get_boolean('use-backlight')) {
	    BrightnessSlider.setValue(curBrightness);
	}
	storeBrightnessLevel(minBrightness);
	return;
    }
    if (curBrightness >= 1) {
	hideOverlays();
    } else {
	let opacity = (1-curBrightness)*255;
	log_debug("on_current_brightness_change: opacity="+opacity);
	showOverlays(opacity);
    }
}

function on_monitors_change() {
    log_debug('on_monitors_change()');
    hideOverlays();
    on_brightness_change();
}

function replacement_sync() {
    log_debug('Brightness Indicator _sync()');
    on_brightness_change();
    BrightnessSlider.setValue(getBrightnessLevel());
}

function on_use_backlight_change() {
    log_debug('on_use_backlight_change()');
    if (settings.get_boolean('use-backlight')) {
	storeBrightnessLevel(settings.get_double('current-brightness'));
    } else if (Brightness._proxy.Brightness != null && Brightness._proxy.Brightness >= 0) {
	storeBrightnessLevel(Brightness._proxy.Brightness / 100.0);
    }
}

function init() {
    log_debug('init()');
    Convenience.initTranslations();
}

function enable() {
    if (enabled) {
	log_debug('enable(), session mode = '+Main.sessionMode.currentMode+", skipping as already enabled");
    } else {
	if (sliderChangedBacklightCode == null) {
	    for (let i= BrightnessSlider._signalConnections.length-1; i>=0; --i) {
		let signalConnection = BrightnessSlider._signalConnections[i];
		if (signalConnection.name == 'value-changed') {
		    sliderChangedBacklightCode = signalConnection.callback;
		    sliderChangedBacklightConnection = signalConnection.id;
		    log_debug("Identified signal id "+sliderChangedBacklightConnection+" as backlight brightness control");
		    break;
		}
	    }
	    if (sliderChangedBacklightCode == null) {
		log("cannot find brightness value-changed handler");
		return;
	    }
	}
	settings = Convenience.getSettings();
	debugSettingChangedConnection = settings.connect('changed::debug', on_debug_change);
	debug = settings.get_boolean('debug');
	log_debug('enable(), session mode = '+Main.sessionMode.currentMode);
	if (sliderChangedBacklightConnection != null) {
	    BrightnessSlider.disconnect(sliderChangedBacklightConnection);
	    sliderChangedBacklightConnection = null;
	}
	if (brightnessIndicatorOriginalSync == null) {
	    brightnessIndicatorOriginalSync = imports.ui.status.brightness.Indicator.prototype._sync;
	    imports.ui.status.brightness.Indicator.prototype._sync = imports.ui.status.brightness.Indicator.wrapFunction('_sync', replacement_sync);
	}
	sliderChangedConnection = BrightnessSlider.connect('value-changed', sliderChanged);
	monitorsChangedConnection = Main.layoutManager.connect('monitors-changed', on_monitors_change);
	minBrightnessSettingChangedConnection = settings.connect('changed::min-brightness', on_brightness_change);
	currentBrightnessSettingChangedConnection = settings.connect('changed::current-brightness', on_brightness_change);
	monitorsSettingChangedConnection = settings.connect('changed::monitors', on_monitors_change);
	useBacklightSettingChangedConnection = settings.connect('changed::use-backlight', on_use_backlight_change);

	// If we use the backlight and the Brightness proxy is null, it's still connecting and we'll get a _sync later.
	if (! settings.get_boolean('use-backlight') || Brightness._proxy.Brightness != null) {
	    let curBrightness = getBrightnessLevel();
	    sliderChanged(BrightnessSlider, curBrightness);
	    BrightnessSlider.setValue(curBrightness);
	}

	// Show the slider, it can be hidden on some systems - this is
	// not undone at disable() time
	Brightness._item.actor.visible = true;

	enabled = true;
    }
}

function disable() {
    if (Main.sessionMode.currentMode == 'unlock-dialog') {
	log_debug('disable() skipped as session-mode = unlock-dialog');
    } else if (enabled) {
	log_debug('disable(), session mode = '+Main.sessionMode.currentMode);
	settings.disconnect(debugSettingChangedConnection);
	Main.layoutManager.disconnect(monitorsChangedConnection);
	settings.disconnect(minBrightnessSettingChangedConnection);
	settings.disconnect(currentBrightnessSettingChangedConnection);
	settings.disconnect(monitorsSettingChangedConnection);
	BrightnessSlider.disconnect(sliderChangedConnection);
	if (sliderChangedBacklightConnection == null) {
	    sliderChangedBacklightConnection = BrightnessSlider.connect('value-changed', sliderChangedBacklightCode);
	}
	if (brightnessIndicatorOriginalSync != null) {
	    imports.ui.status.brightness.Indicator.prototype._sync = brightnessIndicatorOriginalSync;
	    brightnessIndicatorOriginalSync = null;
	}
	hideOverlays();
	settings.run_dispose();
	enabled = false;
    } else {
	log('disabled() called when not enabled');
    }
}
