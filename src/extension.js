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

const AggregateMenu = imports.ui.main.panel.statusArea.aggregateMenu;
const Clutter = imports.gi.Clutter;
const Indicator = imports.ui.status.brightness.Indicator;
const Lang = imports.lang;
const Main = imports.ui.main;
const Magnifier = imports.ui.magnifier;
const Meta = imports.gi.Meta;
const PointerWatcher = imports.ui.pointerWatcher;
const ScreenshotService = imports.ui.screenshot.ScreenshotService;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Convenience = Me.imports.convenience;
const Utils = Me.imports.utils;
const Logger = Me.imports.logger;

var softBrightnessExtension = null;

const ModifiedBrightnessIndicator = class ModifiedBrightnessIndicator extends Indicator {
    constructor(softBrightnessExtension) {
	super();
	this._softBrightnessExtension = softBrightnessExtension;
    }

    _sliderChanged(slider, value) {
	this._softBrightnessExtension._logger.log_debug("_sliderChanged(slide, "+value+")");
	this._softBrightnessExtension._storeBrightnessLevel(value);
    }

    _sync() {
	this._softBrightnessExtension._logger.log_debug("_sync()");
	this._softBrightnessExtension._on_brightness_change(false);
	this._slider.setValue(this._softBrightnessExtension._getBrightnessLevel());
    }
};

const SoftBrightnessExtension = class SoftBrightnessExtension {
    constructor() {
	// Set/destroyed by enable/disable
	this._enabled			    = false;
	this._logger			    = null;
	this._settings			    = null;
	this._debugSettingChangedConnection = null;

	// Set/destroyed by _enable/_disable
	this._brightnessIndicator    = null;
	this._actorGroup             = null;
	this._actorAddedConnection   = null;
	this._actorRemovedConnection = null;

	// Set/destroyed by _showOverlays/_hideOverlays
	this._unredirectPrevented = false;
	this._overlays            = null;

	// Set/destroyed by _enableSettingsMonitoring/_disableSettingsMonitoring
	this._minBrightnessSettingChangedConnection     = null;
	this._currentBrightnessSettingChangedConnection = null;
	this._monitorsSettingChangedConnection          = null;
	this._builtinMonitorSettingChangedConnection    = null;
	this._useBacklightSettingChangedConnection      = null;
	this._preventUnredirectChangedConnection        = null;

	// Set/destroyed by _enableMonitor2ing/_disableMonitor2ing
	this._monitorManager            = null;
	this._displayConfigProxy        = null;
	this._monitorsChangedConnection = null;
	this._monitorNames              = null;

	// Set/destroyed by _enableCloningMouse/_disableCloningMouse
	this._cursorWantedVisible                 = null;
	this._cursorTracker			  = null;
	this._cursorTrackerSetPointerVisible	  = null;
	this._cursorTrackerSetPointerVisibleBound = null;
	this._cursorSprite			  = null;
	this._cursorActor			  = null;
	this._cursorWatcher			  = null;
	// Set/destroyed by _startCloningMouse / _stopCloningMouse
	this._cursorWatch			  = null;
	this._cursorChangedConnection		  = null;
	// Set/destroyed by _delayedSetPointerInvisible/_clearRedrawConnection
	this._redrawConnection                    = null;

	// Set/destroyed by _enableScreenshotPatch/_disableScreenshotPatch
	this._screenshotServiceScreenshotAsync       = null;
	this._screenshotServiceScreenshotAreaAsync   = null;
	this._screenshotService_onScreenShotComplete = null;
    }

    // Base functionality: set-up and tear down logger, settings and debug setting monitoring
    enable() {
	if (this._enabled) {
	    this._logger.log_debug('enable(), session mode = '+Main.sessionMode.currentMode+", skipping as already enabled");
	} else {
	    this._logger = new Logger.Logger('Soft-Brightness');
	    this._settings = Convenience.getSettings();
	    this._debugSettingChangedConnection = this._settings.connect('changed::debug', this._on_debug_change.bind(this));
	    this._logger.set_debug(this._settings.get_boolean('debug'));
	    this._logger.log_debug('enable(), session mode = '+Main.sessionMode.currentMode);
	    this._enable();
	    this._enabled = true;
	    this._logger.log_debug('Extension enabled');
	}
    }

    disable() {
	if (Main.sessionMode.currentMode == 'unlock-dialog') {
	    this._logger.log_debug('disable() skipped as session-mode = unlock-dialog');
	} else if (this._enabled) {
	    this._logger.log_debug('disable(), session mode = '+Main.sessionMode.currentMode);
	    this._settings.disconnect(this._debugSettingChangedConnection);
	    this._disable();
	    this._settings.run_dispose();
	    this._settings = null;
	    this._enabled = false;
	    this._logger.log_debug('Extension disabled');
	    this._logger = null;
	} else {
	    this._logger.log('disabled() called when not enabled');
	}
    }

    _on_debug_change() {
	this._logger.set_debug(this._settings.get_boolean('debug'));
	this._logger.log('debug = '+this._logger.get_debug());
    }

    // Main enable / disable switch
    _enable() {
	this._logger.log_debug('_enable()');

	this._actorGroup = new St.Widget({ name: 'soft-brightness-overlays' });
	global.stage.add_actor(this._actorGroup);

	this._actorAddedConnection   = global.stage.connect('actor-added',   this._restackOverlays.bind(this));
	this._actorRemovedConnection = global.stage.connect('actor-removed', this._restackOverlays.bind(this));

	this._enableCloningMouse();

	this._brightnessIndicator = new ModifiedBrightnessIndicator(this);
	if (! this._swapMenu(AggregateMenu._brightness, this._brightnessIndicator)) {
	    return;
	}

	this._enableMonitor2ing();
	this._enableSettingsMonitoring();

	// If we use the backlight and the Brightness proxy is null, it's still connecting and we'll get a _sync later.
	if (! this._settings.get_boolean('use-backlight') || this._brightnessIndicator._proxy.Brightness != null) {
	    let curBrightness = this._getBrightnessLevel();
	    this._brightnessIndicator._sliderChanged(this._brightnessIndicator._slider, curBrightness);
	    this._brightnessIndicator._slider.setValue(curBrightness);
	}

	this._enableScreenshotPatch();
    }

    _disable() {
	this._logger.log_debug('_disable()');

	let standardIndicator = new imports.ui.status.brightness.Indicator();
	this._swapMenu(this._brightnessIndicator, standardIndicator);
	this._brightnessIndicator = null;

	this._disableMonitor2ing();
	this._disableSettingsMonitoring();

	this._hideOverlays(true);

	this._stopCloningShowMouse();
	this._disableCloningMouse(); // Must be called after _stopCloningShowMouse

	this._disableScreenshotPatch();

	global.stage.disconnect(this._actorAddedConnection);
	global.stage.disconnect(this._actorRemovedConnection);

	this._actorAddedConnection   = null;
	this._actorRemovedConnection = null;

	global.stage.remove_actor(this._actorGroup);
	this._actorGroup.destroy();
	this._actorGroup = null;
    }

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
	    this._logger.log('_swapMenu(): Cannot find brightness indicator');
	    return false;
	}
	this._logger.log_debug('_swapMenu(): Replacing brightness menu item at index '+menuIndex);
	menuItems.splice(menuIndex, 1);
	oldIndicator._proxy.run_dispose();
	oldIndicator.menu.destroy();
	AggregateMenu.menu.addMenuItem(newIndicator.menu, menuIndex);
	AggregateMenu._brightness = newIndicator;
	return true;
    }

    _restackOverlays() {
	this._logger.log_debug('_restackOverlays()');
	this._actorGroup.raise_top();
	if (this._overlays != null) {
	    for (let i=0; i < this._overlays.length; ++i) {
		this._overlays[i].raise_top();
	    }
	    this._setPointerVisible(false);
	}
    }

    // Core functions to show & hide overlays
    _showOverlays(brightness, force) {
	this._logger.log_debug('_showOverlays('+brightness+', '+force+')');
	if (this._overlays == null || force) {
	    let enabledMonitors = this._settings.get_string('monitors');
	    let monitors;
	    this._logger.log_debug('_showOverlays(): enabledMonitors="'+enabledMonitors+'"');
	    if (enabledMonitors == "all") {
		monitors = Main.layoutManager.monitors;
	    } else if (enabledMonitors == "built-in" || enabledMonitors == "external") {
		if (this._monitorNames == null) {
		    this._logger.log_debug("_showOverlays(): skipping run as _monitorNames hasn't been set yet.");
		    return;
		}
		let builtinMonitorName = this._settings.get_string('builtin-monitor');
		this._logger.log_debug('_showOverlays(): builtinMonitorName="'+builtinMonitorName+'"');
		if (builtinMonitorName == "" || builtinMonitorName == null) {
		    builtinMonitorName = this._monitorNames[Main.layoutManager.primaryIndex];
		    this._logger.log_debug('_showOverlays(): no builtin monitor, setting to "'+builtinMonitorName+'" and skipping run');
		    this._settings.set_string('builtin-monitor', builtinMonitorName);
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
		this._logger.log("_showOverlays(): Unhandled \"monitors\" setting = "+enabledMonitors);
		return;
	    }
	    if (force) {
		this._hideOverlays(false);
	    }
	    let preventUnredirect = this._settings.get_string('prevent-unredirect');
	    switch(preventUnredirect) {
	    case "always":
	    case "when-correcting":
		this._preventUnredirect();
		break;
	    case "never":
		this._allowUnredirect();
		break;
	    default:
		this._logger.log('_showOverlays(): Unexpected prevent-unredirect="'+preventUnredirect+'"');
		break;
	    }

	    this._overlays = [];
	    for (let i=0; i < monitors.length; ++i) {
		let monitor = monitors[i];
		this._logger.log_debug('Create overlay #'+i+': '+monitor.width+'x'+monitor.height+'@'+monitor.x+','+monitor.y);
		let overlay = new St.Label({
		    style: 'border-radius: 0px; background-color: rgba(0,0,0,1);',
		    text: "",
		});
		overlay.set_position(monitor.x, monitor.y);
		overlay.set_width(monitor.width);
		overlay.set_height(monitor.height);

		this._actorGroup.add_actor(overlay);
		Shell.util_set_hidden_from_pick(overlay, true);

		this._overlays.push(overlay);
	    }
	}

	let opacity = (1.0-brightness)*255;
	for (let i=0; i < this._overlays.length; ++i) {
	    this._logger.log_debug('_showOverlay(): set opacity '+opacity+' on overlay #'+i);
	    this._overlays[i].opacity = opacity;
	}
    }

    _hideOverlays(forceUnpreventUnredirect) {
	if (this._overlays != null) {
	    this._logger.log_debug("_hideOverlays(): drop overlays, count="+this._overlays.length);
	    for (let i=0; i < this._overlays.length; ++i) {
		this._actorGroup.remove_actor(this._overlays[i]);
	    }
	    this._overlays = null;
	}

	let preventUnredirect = this._settings.get_string('prevent-unredirect');
	if (forceUnpreventUnredirect) {
	    preventUnredirect = 'never';
	}
	switch(preventUnredirect) {
	case "always":
	    this._preventUnredirect();
	    break;
	case "when-correcting":
	case "never":
	    this._allowUnredirect();
	    break;
	default:
	    this._logger.log('_hideOverlays(): Unexpected prevent-unredirect="'+preventUnredirect+'"');
	    break;
	}
    }

    _preventUnredirect() {
	if (! this._unredirectPrevented) {
	    this._logger.log_debug('_preventUnredirect(): disabling unredirects, prevent-unredirect='+this._settings.get_string('prevent-unredirect'));
	    if (Meta.disable_unredirect_for_display) {
		// Shell 3.30+
		Meta.disable_unredirect_for_display(global.display);
	    } else {
		// Shell 3.28-
		Meta.disable_unredirect_for_screen(global.screen);
	    }
	    this._unredirectPrevented = true;
	}
    }

    _allowUnredirect() {
	if (this._unredirectPrevented) {
	    this._logger.log_debug('_allowUnredirect(): enabling unredirects, prevent-unredirect='+this._settings.get_string('prevent-unredirect'));
	    if (Meta.enable_unredirect_for_display) {
		// Shell 3.30+
		Meta.enable_unredirect_for_display(global.display);
	    } else {
		// Shell 3.28-
		Meta.enable_unredirect_for_screen(global.screen);
	    }
	    this._unredirectPrevented = false;
	}
    }

    // Utility functions to manage the stored brightness value.
    // If using the backlight, then we use the indicator as the brightness value store, which is linked to gsd.
    // If not using the backlight, the brightness is stored in the extension setting.
    _storeBrightnessLevel(value) {
	if (this._settings.get_boolean('use-backlight') && this._brightnessIndicator._proxy.Brightness >= 0) {
	    let convertedBrightness = Math.min(100, Math.round(value * 100.0)+1);
	    this._logger.log_debug('_storeBrightnessLevel('+value+') by proxy -> '+convertedBrightness);
	    this._brightnessIndicator._proxy.Brightness = convertedBrightness;
	} else {
	    this._logger.log_debug('_storeBrightnessLevel('+value+') by setting');
	    this._settings.set_double('current-brightness', value);
	}
    }

    _getBrightnessLevel() {
	if (this._settings.get_boolean('use-backlight')) {
	    let brightness = this._brightnessIndicator._proxy.Brightness;
	    let convertedBrightness = brightness / 100.0;
	    this._logger.log_debug('_getBrightnessLevel() by proxy = '+convertedBrightness+' <- '+brightness);
	    return convertedBrightness;
	} else {
	    let brightness = this._settings.get_double('current-brightness');
	    this._logger.log_debug('_getBrightnessLevel() by setting = '+brightness);
	    return brightness;
	}
    }

    // Settings monitoring
    _enableSettingsMonitoring() {
	this._logger.log_debug('_enableSettingsMonitoring()');

	let brightnessChange       = Lang.bind(this, function() { this._on_brightness_change(false); });
	let forcedBrightnessChange = Lang.bind(this, function() { this._on_brightness_change(true); });

	this._minBrightnessSettingChangedConnection     = this._settings.connect('changed::min-brightness',     brightnessChange);
	this._currentBrightnessSettingChangedConnection = this._settings.connect('changed::current-brightness', brightnessChange);
	this._monitorsSettingChangedConnection          = this._settings.connect('changed::monitors',           forcedBrightnessChange);
	this._builtinMonitorSettingChangedConnection    = this._settings.connect('changed::builtin-monitor',    forcedBrightnessChange);
	this._useBacklightSettingChangedConnection      = this._settings.connect('changed::use-backlight',      this._on_use_backlight_change.bind(this));
	this._preventUnredirectChangedConnection        = this._settings.connect('changed::prevent-unredirect', forcedBrightnessChange);
    }

    _disableSettingsMonitoring() {
	this._logger.log_debug('_disableSettingsMonitoring()');

	this._settings.disconnect(this._minBrightnessSettingChangedConnection);
	this._settings.disconnect(this._currentBrightnessSettingChangedConnection);
	this._settings.disconnect(this._monitorsSettingChangedConnection);
	this._settings.disconnect(this._builtinMonitorSettingChangedConnection);
	this._settings.disconnect(this._useBacklightSettingChangedConnection);
	this._settings.disconnect(this._preventUnredirectChangedConnection);

	this._minBrightnessSettingChangedConnection     = null;
	this._currentBrightnessSettingChangedConnection = null;
	this._monitorsSettingChangedConnection          = null;
	this._builtinMonitorSettingChangedConnection    = null;
	this._useBacklightSettingChangedConnection      = null;
	this._preventUnredirectChangedConnection        = null;
    }

    _on_brightness_change(force) {
	let curBrightness = this._getBrightnessLevel();
	let minBrightness = this._settings.get_double('min-brightness');

	this._logger.log_debug("_on_brightness_change: current-brightness="+curBrightness+", min-brightness="+minBrightness);
	if (curBrightness < minBrightness) {
	    curBrightness = minBrightness;
	    if (! this._settings.get_boolean('use-backlight')) {
		this._brightnessIndicator._slider.setValue(curBrightness);
	    }
	    this._storeBrightnessLevel(minBrightness);
	    return;
	}
	if (curBrightness >= 1) {
	    this._hideOverlays(false);
	    this._stopCloningShowMouse();
	} else {
	    if (this._cursorWantedVisible) {
		this._startCloningMouse(); // Must be called before _showOverlays so that the overlay is on top.
	    }
	    this._showOverlays(curBrightness, force);
	}
    }

    _on_use_backlight_change() {
	this._logger.log_debug('_on_use_backlight_change()');
	if (this._settings.get_boolean('use-backlight')) {
	    this._storeBrightnessLevel(this._settings.get_double('current-brightness'));
	} else if (this._brightnessIndicator._proxy.Brightness != null && this._brightnessIndicator._proxy.Brightness >= 0) {
	    this._storeBrightnessLevel(this._brightnessIndicator._proxy.Brightness / 100.0);
	}
    }

    // Monitor change handling
    _enableMonitor2ing() {
	this._logger.log_debug('_enableMonitor2ing()');

	this._monitorManager = Meta.MonitorManager.get();
	Utils.newDisplayConfig(Lang.bind(this, function(proxy, error) {
	    if (error) {
		this._logger.log("newDisplayConfig() callback: Cannot get Display Config: " + error);
		return;
	    }
	    this._logger.log_debug('newDisplayConfig() callback');
	    this._displayConfigProxy = proxy;
	    this._on_monitors_change();
	}));

	this._monitorsChangedConnection = Main.layoutManager.connect('monitors-changed', this._on_monitors_change.bind(this));
    }

    _disableMonitor2ing() {
	this._logger.log_debug('_disableMonitor2ing()');

	Main.layoutManager.disconnect(this._monitorsChangedConnection);

	this._monitorsChangedConnection = null;
	this._displayConfigProxy        = null;
	this._monitorManager            = null;
	this._monitorNames              = null;
    }

    _on_monitors_change() {
	if (this._displayConfigProxy == null) {
	    this._logger.log_debug("_on_monitors_change(): skipping run as the proxy hasn't been set up yet.");
	    return;
	}
	this._logger.log_debug("_on_monitors_change()");
	Utils.getMonitorConfig(this._displayConfigProxy, Lang.bind(this, function(result, error) {
	    if (error) {
		this._logger.log("_on_monitors_change(): cannot get Monitor Config: "+error);
		return;
	    }
	    let monitorNames = [];
	    for (let i=0; i < result.length; ++i) {
		let [monitorName, connectorName] = result[i];
		let monitorIndex = this._monitorManager.get_monitor_for_connector(connectorName);
		this._logger.log_debug('_on_monitors_change(): monitor="'+monitorName+'", connector="'+connectorName+'", index='+monitorIndex);
		if (monitorIndex >= 0) {
		    monitorNames[monitorIndex] = monitorName;
		}
	    }
	    this._monitorNames = monitorNames;
	    this._on_brightness_change(true);
	}));
    }

    // Cursor handling
    _enableCloningMouse() {
	this._logger.log_debug('_enableCloningMouse()');

	this._cursorWantedVisible = true;
	if (Meta.CursorTracker.get_for_display) {
	    // Shell 3.30+
	    this._cursorTracker = Meta.CursorTracker.get_for_display(global.display);
	} else {
	    // Shell 3.28
	    this._cursorTracker = new Meta.CursorTracker();
	}
	this._cursorTrackerSetPointerVisible = Meta.CursorTracker.prototype.set_pointer_visible;
	this._cursorTrackerSetPointerVisibleBound = this._cursorTrackerSetPointerVisible.bind(this._cursorTracker);
	Meta.CursorTracker.prototype.set_pointer_visible = this._cursorTrackerSetPointerVisibleReplacement.bind(this);

	if (Magnifier.MouseSpriteContent) {
	    this._logger.log_debug('_enableCloningMouse(): using Gnome Shell 3.32 method');
	    this._cursorSprite = new Clutter.Actor({ request_mode: Clutter.RequestMode.CONTENT_SIZE });
	    this._cursorSprite.content = new Magnifier.MouseSpriteContent();
	} else {
	    this._logger.log_debug('_enableCloningMouse(): using Gnome Shell 3.30 method');
	    this._cursorSprite = new Clutter.Texture();
	}

	this._cursorActor = new Clutter.Actor();
	this._cursorActor.add_actor(this._cursorSprite);
	this._cursorWatcher = PointerWatcher.getPointerWatcher();
    }

    _disableCloningMouse() {
	this._logger.log_debug('_disableCloningMouse()');

	Meta.CursorTracker.prototype.set_pointer_visible = this._cursorTrackerSetPointerVisible;

	this._cursorWantedVisible                 = null;
	this._cursorTracker			  = null;
	this._cursorTrackerSetPointerVisible	  = null;
	this._cursorTrackerSetPointerVisibleBound = null;
	this._cursorSprite			  = null;
	this._cursorActor			  = null;
	this._cursorWatcher			  = null;
    }

    _setPointerVisible(visible) {
	// this._logger.log_debug('_setPointerVisible('+visible+')');
	let boundFunc = this._cursorTrackerSetPointerVisibleBound;
	boundFunc(visible);
    }

    _cursorTrackerSetPointerVisibleReplacement(visible) {
	// this._logger.log_debug('_cursorTrackerSetPointerVisibleReplacement('+visible+')');
	if (visible) {
	    this._startCloningMouse();
	    // For some reson, exiting the magnifier causes the
	    // stacking order for the cursor and overlay actors to be
	    // swapped around.  Reassert stacking over whenever the
	    // pointer should become visible again.
	    this._restackOverlays();
	} else {
	    this._stopCloningMouse();
	    this._setPointerVisible(false);
	}
	this._cursorWantedVisible = visible;
    }

    _startCloningMouse() {
	this._logger.log_debug('_startCloningMouse()');
	if (this._cursorWatch == null ) {

	    this._actorGroup.add_actor(this._cursorActor);
	    this._cursorChangedConnection = this._cursorTracker.connect('cursor-changed', this._updateMouseSprite.bind(this));
	    this._cursorWatch = this._cursorWatcher.addWatch(1, this._updateMousePosition.bind(this));

	    this._updateMouseSprite();
	    this._updateMousePosition();
	}
	this._setPointerVisible(false);
    }

    _stopCloningShowMouse() {
	this._logger.log_debug('_stopCloningShowMouse()');
	this._stopCloningMouse();
	this._setPointerVisible(true);
    }

    _stopCloningMouse() {
	if (this._cursorWatch != null ) {
	    this._logger.log_debug('_stopCloningMouse()');

	    this._cursorWatch.remove();
	    this._cursorWatch = null;

	    this._cursorTracker.disconnect(this._cursorChangedConnection);
	    this._cursorChangedConnection = null;

	    this._actorGroup.remove_actor(this._cursorActor);
	}

	this._clearRedrawConnection();
    }

    _updateMousePosition(actor, event) {
	// this._logger.log_debug('_updateMousePosition()');
	let [x, y, mask] = global.get_pointer();
	this._cursorActor.set_position(x, y);
	this._delayedSetPointerInvisible();
    }

    _updateMouseSprite() {
	// this._logger.log_debug('_updateMouseSprite()');
	if (Magnifier.MouseSpriteContent) {
	    let sprite = this._cursorTracker.get_sprite();
	    if (sprite) {
		this._cursorSprite.content.texture = sprite;
		this._cursorSprite.show();
	    } else {
		this._cursorSprite.hide();
	    }
	} else {
	    Shell.util_cursor_tracker_to_clutter(this._cursorTracker, this._cursorSprite);
	}
	let [xHot, yHot] = this._cursorTracker.get_hot();
	this._cursorSprite.set_anchor_point(xHot, yHot);
	this._delayedSetPointerInvisible();
    }

    _delayedSetPointerInvisible() {
	// this._logger.log('_delayedSetPointerInvisible()');
	this._setPointerVisible(false);

	if (this._redrawConnection == null) {
	    this._redrawConnection = this._actorGroup.connect('paint', () => {
		// this._logger.log('_delayedSetPointerInvisible::paint()');
		this._clearRedrawConnection();
		this._setPointerVisible(false);
	    });
	}
    }

    _clearRedrawConnection() {
	if (this._redrawConnection != null) {
	    // this._logger.log_debug('_clearRedrawConnection()');
	    this._actorGroup.disconnect(this._redrawConnection);
	    this._redrawConnection = null;
	}
    }

    // Monkey-patched ScreenshotService methods
    _enableScreenshotPatch() {
	this._logger.log_debug('_enableScreenshotPatch()');

	// Monkey patch some screenshot functions to remove the
	// overlay during area and desktop screenshots (unnecessary for window screenshots).
	this._screenshotServiceScreenshotAsync       = ScreenshotService.prototype.ScreenshotAsync;
	this._screenshotServiceScreenshotAreaAsync   = ScreenshotService.prototype.ScreenshotAreaAsync;
	this._screenshotService_onScreenShotComplete = ScreenshotService.prototype._onScreenshotComplete;

	ScreenshotService.prototype.ScreenshotAsync       = this._screenshotAsyncWrapper.bind(this);
	ScreenshotService.prototype.ScreenshotAreaAsync   = this._screenshotAreaAsyncWrapper.bind(this);
	ScreenshotService.prototype._onScreenshotComplete = this._onScreenshotCompleteWrapper.bind(this);
    }

    _disableScreenshotPatch() {
	this._logger.log_debug('_disableScreenshotPatch()');

	// Undo monkey patching of screenshot functions
	ScreenshotService.prototype.ScreenshotAsync       = this._screenshotServiceScreenshotAsync;
	ScreenshotService.prototype.ScreenshotAreaAsync   = this._screenshotServiceScreenshotAreaAsync;
	ScreenshotService.prototype._onScreenshotComplete = this._screenshotService_onScreenShotComplete;

	this._screenshotServiceScreenshotAsync       = null;
	this._screenshotServiceScreenshotAreaAsync   = null;
	this._screenshotService_onScreenShotComplete = null;
    }

    _screenshotAsyncWrapper(...args) {
	this._logger.log_debug('_screenshotAsyncWrapper()');
	this._screenshotStart();
	this._screenshotServiceScreenshotAsync.apply(Main.shellDBusService._screenshotService, args);
    }

    _screenshotAreaAsyncWrapper(...args) {
	this._logger.log_debug('_screenshotAreaAsyncWrapper()');
	this._screenshotStart();
	this._screenshotServiceScreenshotAreaAsync.apply(Main.shellDBusService._screenshotService, args);
    }

    _screenshotStart() {
	this._hideOverlays(false);
	this._stopCloningMouse();
	this._setPointerVisible(false);
    }

    _onScreenshotCompleteWrapper(...args) {
	this._logger.log_debug('_onScreenshotCompleteWrapper()');
	this._on_brightness_change(false);
	this._screenshotService_onScreenShotComplete.apply(Main.shellDBusService._screenshotService, args);
    }

};

function init() {
    softBrightnessExtension = new SoftBrightnessExtension();
    return softBrightnessExtension;
}
