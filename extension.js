const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.convenience;
const BrightnessSlider = imports.ui.main.panel.statusArea.aggregateMenu._brightness._slider;

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
let sliderChangedBacklightConnection = null;
let sliderChangedBacklightCode = null;
let sliderChangedConnection = null;
let initTimeoutId = null;

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

function sliderChanged(slider, value) {
    log_debug("sliderChanged, value="+value);
    settings.set_double('current-brightness', value);
}

function on_debug_change() {
    debug = settings.get_boolean('debug');
    log('debug = '+debug);
}

function clearInitTimeout() {
    if (initTimeoutId != null) {
	Mainloop.source_remove(initTimeoutId);
	initTimeoutId = null;
    }
}

function on_brightness_change() {
    let curBrightness = settings.get_double('current-brightness');
    let minBrightness = settings.get_double('min-brightness');

    log_debug("on_brightness_change: current-brightness="+curBrightness+", min-brightness="+minBrightness);
    clearInitTimeout();
    if (curBrightness < minBrightness) {
	curBrightness = minBrightness;
	if (! settings.get_boolean('use-backlight')) {
	    BrightnessSlider.setValue(curBrightness);
	}
	settings.set_double('current-brightness', minBrightness);
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
    hideOverlays();
    on_brightness_change();
}

function disableBacklightControl() {
    log_debug('disableBacklightControl()');
    if (sliderChangedBacklightConnection != null) {
	BrightnessSlider.disconnect(sliderChangedBacklightConnection);
	sliderChangedBacklightConnection = null;
    }
}

function enableBacklightControl() {
    log_debug('enableBacklightControl()');
    if (sliderChangedBacklightConnection == null) {
	sliderChangedBacklightConnection = BrightnessSlider.connect('value-changed', sliderChangedBacklightCode);
    }
}

function on_use_backlight_change() {
    if (settings.get_boolean('use-backlight')) {
	enableBacklightControl();
    } else {
	disableBacklightControl();
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
	if (! settings.get_boolean('use-backlight')) {
	    disableBacklightControl();
	}
	sliderChangedConnection = BrightnessSlider.connect('value-changed', sliderChanged);
	monitorsChangedConnection = Main.layoutManager.connect('monitors-changed', on_monitors_change);
	minBrightnessSettingChangedConnection = settings.connect('changed::min-brightness', on_brightness_change);
	currentBrightnessSettingChangedConnection = settings.connect('changed::current-brightness', on_brightness_change);
	monitorsSettingChangedConnection = settings.connect('changed::monitors', on_monitors_change);
	useBacklightSettingChangedConnection = settings.connect('changed::use-backlight', on_use_backlight_change);

	let curBrightness = settings.get_double('current-brightness');
	sliderChanged(BrightnessSlider, curBrightness);
	// This is fugly.
	BrightnessSlider.setValue(curBrightness);
	initTimeoutId = Mainloop.timeout_add_seconds(3, function() {
	    log_debug('Initialing brightness set = '+curBrightness);
	    BrightnessSlider.setValue(curBrightness);
	    initTimeoutId = null;
	});

	enabled = true;
    }
}

function disable() {
    if (Main.sessionMode.currentMode == 'unlock-dialog') {
	log_debug('disable() skipped as session-mode = unlock-dialog');
    } else if (enabled) {
	log_debug('disable(), session mode = '+Main.sessionMode.currentMode);
	clearInitTimeout();
	settings.disconnect(debugSettingChangedConnection);
	Main.layoutManager.disconnect(monitorsChangedConnection);
	settings.disconnect(minBrightnessSettingChangedConnection);
	settings.disconnect(currentBrightnessSettingChangedConnection);
	settings.disconnect(monitorsSettingChangedConnection);
	BrightnessSlider.disconnect(sliderChangedConnection);
	enableBacklightControl();
	hideOverlays();
	settings.run_dispose();
	enabled = false;
    } else {
	log('disabled() called when not enabled');
    }
}
