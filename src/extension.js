// soft-brightness-plus - Control the display's brightness via an alpha channel.
// Copyright (C) 2019-2022 Philippe Troin (F-i-f on Github)
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

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import System from 'system';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';

import * as Logger from './logger.js';
import * as Utils from './utils.js';
import { MouseSpriteContent } from './cursor.js';

const BrightnessInterface = loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen');
const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessInterface);

const BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';

export default class SoftBrightnessExtension extends Extension {
    constructor(...args) {
        super(...args);

        // Set/destroyed by enable/disable
        this._logger                                     = null;
        this._settings                                   = null;
        this._debugSettingChangedConnection              = null;

        // Set/destroyed by _enable/_disable
        this._actorGroup                                 = null;
        this._actorAddedConnection                       = null;
        this._actorRemovedConnection                     = null;
        this._delayedMouseCloning                        = null;
        this._cloneMouseSetting                          = null;
        this._cloneMouseSettingChangedConnection         = null;
        this._brightnessIndicator                        = null;

        // Set/destroyed by _showOverlays/_hideOverlays
        this._unredirectPrevented                        = false;
        this._overlays                                   = null;

        // Set/destroyed by _enableSettingsMonitoring/_disableSettingsMonitoring
        this._minBrightnessSettingChangedConnection      = null;
        this._currentBrightnessSettingChangedConnection  = null;
        this._monitorsSettingChangedConnection           = null;
        this._builtinMonitorSettingChangedConnection     = null;
        this._useBacklightSettingChangedConnection       = null;
        this._preventUnredirectChangedConnection         = null;

        // Set/destroyed by _enableMonitor2ing/_disableMonitor2ing
        this._monitorManager                             = null;
        this._displayConfigProxy                         = null;
        this._monitorsChangedConnection                  = null;
        this._monitorNames                               = null;

        // Set/destroyed by _enableCloningMouse/_disableCloningMouse
        this._cursorWantedVisible                        = null;
        this._cursorTracker                              = null;
        this._cursorTrackerSetPointerVisible             = null;
        this._cursorTrackerSetPointerVisibleBound        = null;
        this._cursorSprite                               = null;
        this._cursorActor                                = null;
        this._cursorWatcher                              = null;
        this._cursorSeat                                 = null;
        // Set/destroyed by _startCloningMouse / _stopCloningMouse
        this._cursorWatch                                = null;
        this._cursorChangedConnection                    = null;
        this._cursorVisibilityChangedConnection          = null;
        // Set/destroyed by _delayedSetPointerInvisible/_clearDelayedSetPointerInvibleCallbacks
        this._delayedSetPointerInvisibleIdleSource       = null;
        this._delayedSetPointerInvisibleRedrawConnection = null;

        // Set/destroyed by _enableScreenshotPatch/_disableScreenshotPatch
        this._screenshotRevertFns                        = [];
    }

    // Base functionality: set-up and tear down logger, settings and debug setting monitoring
    enable() {
        this._logger = new Logger.Logger('soft-brightness-plus', this.metadata, Config.PACKAGE_VERSION);
        this._settings = this.getSettings();
        this._debugSettingChangedConnection = this._settings.connect('changed::debug', this._on_debug_change.bind(this));
        this._logger.set_debug(this._settings.get_boolean('debug'));
        this._logger.log_debug('enable(), session mode = '+Main.sessionMode.currentMode);
        this._enable();
        this._logger.log_debug('Extension enabled');
    }

    // In order to maintain the same brightness settings when the device is
    // locked and unlocked, "session-modes" includes "unlock-dialog" in
    // metadata.json.  The extension will remain active while the lock screen
    // is shown.
    disable() {
        this._logger.log_debug('disable(), session mode = '+Main.sessionMode.currentMode);
        this._settings.disconnect(this._debugSettingChangedConnection);
        this._disable();
        this._settings.run_dispose();
        this._settings = null;
        this._logger.log_debug('Extension disabled');
        this._logger = null;
    }

    _on_debug_change() {
        this._logger.set_debug(this._settings.get_boolean('debug'));
        this._logger.log('debug = '+this._logger.get_debug());
    }

    // Main enable / disable switch
    _enable() {
        this._logger.log_debug('_enable()');

        let gnomeShellVersion = Config.PACKAGE_VERSION;
        if (gnomeShellVersion != undefined) {
            let splitVersion = gnomeShellVersion.split('.').map((x) => {
                x = Number(x);
                if (Number.isNaN(x)) {
                    return 0;
                } else {
                    return x;
                }
            });
            let major = splitVersion[0];
            let minor = splitVersion.length >= 2 ? splitVersion[1] : 0;
            let patch = splitVersion.length >= 3 ? splitVersion[2] : 0;
            let xdgSessionType = GLib.getenv('XDG_SESSION_TYPE');
            let onWayland = xdgSessionType == 'wayland';
            this._logger.log_debug('_enable(): gnome-shell version major='+major+', minor='+minor+', patch='+patch+', system_version='+System.version+', XDG_SESSION_TYPE='+xdgSessionType);
            this._logger.log_debug('_enable(): onWayland='+onWayland);
        }

        this._actorGroup = new St.Widget({ name: 'soft-brightness-plus-overlays' });
        this._actorGroup.set_size(global.screen_width, global.screen_height);
        Shell.util_set_hidden_from_pick(this._actorGroup, true);
        global.stage.add_actor(this._actorGroup);

        this._actorAddedConnection   = global.stage.connect('actor-added',   this._restackOverlays.bind(this));
        this._actorRemovedConnection = global.stage.connect('actor-removed', this._restackOverlays.bind(this));

        // For some reason, starting the mouse cloning at this stage fails when gnome-shell is restarting on x11 and
        // the mouse listener doesn't receive any events.  Adding a small delay before starting the whole mouse
        // cloning business helps.
        this._delayedMouseCloning = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            500,
            (function() {
                this._cloneMouseSetting = this._settings.get_boolean('clone-mouse');
                this._enableCloningMouse();
                this._cloneMouseSettingChangedConnection = this._settings.connect('changed::clone-mouse', this._on_clone_mouse_change.bind(this));
                this._delayedMouseCloning = null;
                // Start mouse cloning and force recreating overlays.
                this._on_brightness_change(true);
            }).bind(this));

        if (Main.panel.statusArea.hasOwnProperty('aggregateMenu')) {
            // GS 42-
            this._brightnessIndicator = Main.panel.statusArea.aggregateMenu._brightness;
            this._brightnessSlider = this._brightnessIndicator._slider;
        } else {
            // GS 43+
            this._brightnessIndicator = Main.panel.statusArea.quickSettings._brightness.quickSettingsItems[0];
            this._brightnessSlider = this._brightnessIndicator.slider;
        }
        this._enableBrightnessIndicatorPatch();
        this._enableMonitor2ing();
        this._enableSettingsMonitoring();

        this._enableScreenshotPatch();
    }

    _disable() {
        this._logger.log_debug('_disable()');

        this._disableBrightnessIndicatorPatch();
        this._disableMonitor2ing();
        this._disableSettingsMonitoring();

        this._hideOverlays(true);

        if (this._delayedMouseCloning !== null) {
            GLib.source_remove(this._delayedMouseCloning);
            this._delayedMouseCloning = null;
        }
        if (this._cloneMouseSettingChangedConnection !== null) {
            this._settings.disconnect(this._cloneMouseSettingChangedConnection);
            this._cloneMouseSettingChangedConnection = null;
        }
        this._disableCloningMouse();
        this._cloneMouseSetting = null;

        this._disableScreenshotPatch();

        global.stage.disconnect(this._actorAddedConnection);
        global.stage.disconnect(this._actorRemovedConnection);

        this._actorAddedConnection   = null;
        this._actorRemovedConnection = null;

        global.stage.remove_actor(this._actorGroup);
        this._actorGroup.destroy();
        this._actorGroup = null;
    }

    _restackOverlays() {
        this._logger.log_debug('_restackOverlays()');
        this._actorGroup.get_parent().set_child_above_sibling(this._actorGroup, null);
        if (this._overlays != null) {
            for (let i=0; i < this._overlays.length; ++i) {
                this._actorGroup.set_child_above_sibling(this._overlays[i], null);
            }
        }
        if (this._overlays != null) {
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
            if (enabledMonitors == 'all') {
                monitors = Main.layoutManager.monitors;
            } else if (enabledMonitors == 'built-in' || enabledMonitors == 'external') {
                if (this._monitorNames == null) {
                    this._logger.log_debug('_showOverlays(): skipping run as _monitorNames hasn\'t been set yet.');
                    return;
                }
                let builtinMonitorName = this._settings.get_string('builtin-monitor');
                this._logger.log_debug('_showOverlays(): builtinMonitorName="'+builtinMonitorName+'"');
                if (builtinMonitorName == '' || builtinMonitorName == null) {
                    builtinMonitorName = this._monitorNames[Main.layoutManager.primaryIndex];
                    this._logger.log_debug('_showOverlays(): no builtin monitor, setting to "'+builtinMonitorName+'" and skipping run');
                    this._settings.set_string('builtin-monitor', builtinMonitorName);
                    return;
                }
                monitors = [];
                for (let i=0; i < Main.layoutManager.monitors.length; ++i) {
                    if ((enabledMonitors == 'built-in' && this._monitorNames[i] == builtinMonitorName) ||
                        (enabledMonitors == 'external' && this._monitorNames[i] != builtinMonitorName)) {
                        monitors.push(Main.layoutManager.monitors[i]);
                    }
                }
            } else {
                this._logger.log('_showOverlays(): Unhandled "monitors" setting = '+enabledMonitors);
                return;
            }
            if (force) {
                this._hideOverlays(false);
            }
            let preventUnredirect = this._settings.get_string('prevent-unredirect');
            switch(preventUnredirect) {
            case 'always':
            case 'when-correcting':
                this._preventUnredirect();
                break;
            case 'never':
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
                    text: '',
                });
                overlay.set_position(monitor.x, monitor.y);
                overlay.set_width(monitor.width);
                overlay.set_height(monitor.height);

                this._actorGroup.add_actor(overlay);
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
            this._logger.log_debug('_hideOverlays(): drop overlays, count='+this._overlays.length);
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
        case 'always':
            this._preventUnredirect();
            break;
        case 'when-correcting':
        case 'never':
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
            Meta.disable_unredirect_for_display(global.display);
            this._unredirectPrevented = true;
        }
    }

    _allowUnredirect() {
        if (this._unredirectPrevented) {
            this._logger.log_debug('_allowUnredirect(): enabling unredirects, prevent-unredirect='+this._settings.get_string('prevent-unredirect'));
            Meta.enable_unredirect_for_display(global.display);
            this._unredirectPrevented = false;
        }
    }

    // Utility functions to manage the stored brightness value.
    // If using the backlight, then we use the indicator as the brightness value store, which is linked to gsd.
    // If not using the backlight, the brightness is stored in the extension setting.
    _storeBrightnessLevel(value) {
        if (this._settings.get_boolean('use-backlight') && this._brightnessIndicator._proxy.Brightness >= 0) {
            let convertedBrightness = Math.min(100, Math.round(value * 100.0));
            this._logger.log_debug('_storeBrightnessLevel('+value+') by proxy -> '+convertedBrightness);
            this._brightnessIndicator._proxy.Brightness = convertedBrightness;
        } else {
            this._logger.log_debug('_storeBrightnessLevel('+value+') by setting');
            this._settings.set_double('current-brightness', value);
        }
    }

    _getBrightnessLevel() {
        let brightness = this._brightnessIndicator._proxy.Brightness;
        if (this._settings.get_boolean('use-backlight') && brightness >= 0) {
            let convertedBrightness = brightness / 100.0;
            this._logger.log_debug('_getBrightnessLevel() by proxy = '+convertedBrightness+' <- '+brightness);
            return convertedBrightness;
        } else {
            brightness = this._settings.get_double('current-brightness');
            this._logger.log_debug('_getBrightnessLevel() by setting = '+brightness);
            return brightness;
        }
    }

    // Settings monitoring
    _enableSettingsMonitoring() {
        this._logger.log_debug('_enableSettingsMonitoring()');

        let brightnessChange       = (function() { this._on_brightness_change(false); }).bind(this);
        let forcedBrightnessChange = (function() { this._on_brightness_change(true); }).bind(this);

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

        this._logger.log_debug('_on_brightness_change: current-brightness='+curBrightness+', min-brightness='+minBrightness);
        if (curBrightness < minBrightness) {
            curBrightness = minBrightness;
            if (! this._settings.get_boolean('use-backlight')) {
                this._brightnessIndicator.setSliderValue(curBrightness);
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
            // _showOverlays may not populate _overlays during initializations if we're waiting from the monitor list callback
            if (this._overlays === null || this._overlays.length == 0) {
                this._stopCloningShowMouse();
            }
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
        this._monitorManager = global.backend.get_monitor_manager();
        Utils.newDisplayConfig(this.path, (function(proxy, error) {
            if (error) {
                this._logger.log('newDisplayConfig() callback: Cannot get Display Config: ' + error);
                return;
            }
            this._logger.log_debug('newDisplayConfig() callback');
            this._displayConfigProxy = proxy;
            this._on_monitors_change();
        }).bind(this));

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
            this._logger.log_debug('_on_monitors_change(): skipping run as the proxy hasn\'t been set up yet.');
            return;
        }
        this._logger.log_debug('_on_monitors_change()');
        Utils.getMonitorConfig(this._displayConfigProxy, (function(result, error) {
            if (error) {
                this._logger.log('_on_monitors_change(): cannot get Monitor Config: '+error);
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
            this._actorGroup.set_size(global.screen_width, global.screen_height);
            this._on_brightness_change(true);
        }).bind(this));
    }

    // Cursor handling
    _isMouseClonable() {
        return this._cloneMouseSetting;
    }

    _on_clone_mouse_change() {
        let cloneMouse = this._settings.get_boolean('clone-mouse');
        if (cloneMouse == this._cloneMouseSetting) {
            this._logger.log_debug('_on_clone_mouse_change(): no setting change, no change');
            return;
        }
        if (cloneMouse) {
            // Starting to clone mouse
            this._logger.log_debug('_on_clone_mouse_change(): starting mouse cloning');
            this._cloneMouseSetting = true;
            this._enableCloningMouse();
            this._on_brightness_change(true);
        } else {
            this._logger.log_debug('_on_clone_mouse_change(): stopping mouse cloning');
            this._disableCloningMouse();
            this._cloneMouseSetting = false;
        }
    }

    _enableCloningMouse() {
        if (!this._isMouseClonable()) return;
        this._logger.log_debug('_enableCloningMouse()');

        this._cursorWantedVisible = true;
        this._cursorTracker = Meta.CursorTracker.get_for_display(global.display);
        this._cursorTrackerSetPointerVisible = Meta.CursorTracker.prototype.set_pointer_visible;
        this._cursorTrackerSetPointerVisibleBound = this._cursorTrackerSetPointerVisible.bind(this._cursorTracker);
        Meta.CursorTracker.prototype.set_pointer_visible = this._cursorTrackerSetPointerVisibleReplacement.bind(this);

        this._cursorSprite = new Clutter.Actor({ request_mode: Clutter.RequestMode.CONTENT_SIZE });
        this._cursorSprite.content = new MouseSpriteContent();

        this._cursorActor = new Clutter.Actor();
        this._cursorActor.add_actor(this._cursorSprite);
        this._cursorWatcher = PointerWatcher.getPointerWatcher();
        this._cursorSeat = Clutter.get_default_backend().get_default_seat();
    }

    _disableCloningMouse() {
        if (!this._isMouseClonable()) return;
        this._stopCloningShowMouse();
        this._logger.log_debug('_disableCloningMouse()');

        Meta.CursorTracker.prototype.set_pointer_visible = this._cursorTrackerSetPointerVisible;

        this._cursorWantedVisible                 = null;
        this._cursorTracker                       = null;
        this._cursorTrackerSetPointerVisible      = null;
        this._cursorTrackerSetPointerVisibleBound = null;
        this._cursorSprite                        = null;
        this._cursorActor                         = null;
        this._cursorWatcher                       = null;
        this._cursorSeat                          = null;
    }

    _setPointerVisible(visible) {
        if (!this._isMouseClonable()) return;
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
        if (!this._isMouseClonable()) return;
        this._logger.log_debug('_startCloningMouse()');
        if (this._cursorWatch == null) {

            this._actorGroup.add_actor(this._cursorActor);
            this._cursorChangedConnection = this._cursorTracker.connect('cursor-changed', this._updateMouseSprite.bind(this));
            this._cursorVisibilityChangedConnection = this._cursorTracker.connect('visibility-changed', this._updateMouseSprite.bind(this));
            let interval = 1000 / 60;
            this._logger.log_debug('_startCloningMouse(): watch interval = '+interval+' ms');
            this._cursorWatch = this._cursorWatcher.addWatch(interval, this._updateMousePosition.bind(this));

            this._updateMouseSprite();
            this._updateMousePosition();
        }
        this._setPointerVisible(false);

        if (this._cursorTracker.set_keep_focus_while_hidden) {
            this._cursorTracker.set_keep_focus_while_hidden(true);
        }

        if (!this._cursorSeat.is_unfocus_inhibited()) {
            this._cursorSeat.inhibit_unfocus();
        }
    }

    _stopCloningShowMouse() {
        if (!this._isMouseClonable()) return;
        this._logger.log_debug('_stopCloningShowMouse(), restoring cursor visibility to '+this._cursorWantedVisible);
        this._stopCloningMouse();
        this._setPointerVisible(this._cursorWantedVisible);

        if (this._cursorTracker.set_keep_focus_while_hidden) {
            this._cursorTracker.set_keep_focus_while_hidden(false);
        }

        if (this._cursorSeat.is_unfocus_inhibited()) {
            this._cursorSeat.uninhibit_unfocus();
        }
    }

    _stopCloningMouse() {
        if (!this._isMouseClonable()) return;
        if (this._cursorWatch != null) {
            this._logger.log_debug('_stopCloningMouse()');

            this._cursorWatch.remove();
            this._cursorWatch = null;

            this._cursorTracker.disconnect(this._cursorChangedConnection);
            this._cursorChangedConnection = null;

            this._cursorTracker.disconnect(this._cursorVisibilityChangedConnection);
            this._cursorVisibilityChangedConnection = null;

            this._actorGroup.remove_actor(this._cursorActor);
        }

        this._clearDelayedSetPointerInvibleCallbacks();
    }

    _updateMousePosition(actor, event) {
        // this._logger.log_debug('_updateMousePosition()');
        let [x, y, mask] = global.get_pointer();
        this._cursorActor.set_position(x, y);
        this._delayedSetPointerInvisible();
    }

    _updateMouseSprite() {
        // this._logger.log_debug('_updateMouseSprite()');
        let sprite = this._cursorTracker.get_sprite();
        if (sprite) {
            this._cursorSprite.content.texture = sprite;
            this._cursorSprite.show();
        } else {
            this._cursorSprite.hide();
        }

        let [xHot, yHot] = this._cursorTracker.get_hot();
        this._cursorSprite.set({
            translation_x: -xHot,
            translation_y: -yHot,
        });
        this._delayedSetPointerInvisible();
    }

    _delayedSetPointerInvisible() {
        // this._logger.log('_delayedSetPointerInvisible()');
        this._setPointerVisible(false);

        // Clear the pointer upon entering idle loop
        if (this._delayedSetPointerInvisibleIdleSource == null) {
            this._delayedSetPointerInvisibleIdleSource = GLib.idle_add(
                GLib.PRIORITY_DEFAULT,
                (function() {
                    this._setPointerVisible(false);
                    this._delayedSetPointerInvisibleIdleSource = null;
                    return false;
                }).bind(this));
        }
    }

    _clearDelayedSetPointerInvibleCallbacks() {
        if (this._delayedSetPointerInvisibleRedrawConnection != null) {
            // this._logger.log_debug('_clearDelayedSetPointerInvibleCallbacks()');
            this._actorGroup.disconnect(this._delayedSetPointerInvisibleRedrawConnection);
            this._delayedSetPointerInvisibleRedrawConnection = null;
        }

        if (this._delayedSetPointerInvisibleIdleSource != null) {
            GLib.source_remove(this._delayedSetPointerInvisibleIdleSource);
            this._delayedSetPointerInvisibleIdleSource = null;
        }
    }

    // Monkey-patched brightness indicator methods
    _enableBrightnessIndicatorPatch() {
        const indicator = this._brightnessIndicator;
        const slider = this._brightnessSlider;
        const ext = this;

        // In GS 42-, despite swapping out the _sync function, the Brightness proxy
        // still calls the old function. GS 42 and GS 43 proxy initialization code is
        // identical. Perhaps there was a bug in how GS 42- SpiderMonkey handles the
        // "this" keyword w.r.t. arrow functions? As a workaround, destroy and
        // re-create the proxy. The new proxy will always call the correct _sync
        // function by name, regardless of which is being used. NOTE: We leave this
        // new Brightness proxy as-is when disabling the extension.
        indicator._proxy.run_dispose();
        indicator._proxy = new BrightnessProxy(
            Gio.DBus.session, BUS_NAME, OBJECT_PATH, (function (proxy, error) {
                if (error)
                    console.error(error.message);
                else
                    this._proxy.connect('g-properties-changed', () => this._sync());
            }).bind(indicator));

        indicator.__orig__sliderChanged = indicator._sliderChanged;
        indicator._sliderChanged = (function() {
            const value = slider.value;
            ext._logger.log_debug('_sliderChanged(slide, '+value+')');
            ext._storeBrightnessLevel(value);
        }).bind(indicator);
        slider.disconnect(indicator._sliderChangedId);
        indicator._sliderChangedId = slider.connect(
          'notify::value', indicator._sliderChanged.bind(indicator));

        indicator.__orig__sync = indicator._sync;
        indicator._sync = (function() {
            ext._logger.log_debug('_sync()');
            ext._on_brightness_change(false);
            this.setSliderValue(ext._getBrightnessLevel());
        }).bind(indicator);

        indicator.__orig_setSliderValue = indicator.setSliderValue;
        indicator.setSliderValue = (function(value) {
            ext._logger.log_debug('setSliderValue('+value+') [GS 3.33.90+]');
            slider.value = value;
        }).bind(indicator);

        // If brightness indicator was previously hidden (i.e. backlight adjustment
        // not available on this device), brightness indicator needs to be manually
        // set to visible for our own use.
        // (e.g. if backlight control not available).
        indicator.visible = true;
        // If "use-backlight" is false when enabling the extention, slider will
        // now be used for adjusting gamma instead of backlight. Run _sync() to
        // update slider to its new value.
        indicator._sync();
    }

    _disableBrightnessIndicatorPatch() {
        const indicator = this._brightnessIndicator;
        const slider = this._brightnessSlider;

        indicator._sliderChanged = indicator.__orig__sliderChanged;
        slider.disconnect(indicator._sliderChangedId);
        indicator._sliderChangedId = slider.connect(
          'notify::value', indicator._sliderChanged.bind(indicator));
        delete indicator.__orig__sliderChanged;

        indicator._sync = indicator.__orig__sync;
        delete indicator.__orig__sync;

        indicator.setSliderValue = indicator.__orig_setSliderValue;
        delete indicator.__orig_setSliderValue;

        // If "use-backlight" is false and slider was being used for adjusting gamma,
        // slider will now revert to its previous use of backlight adjustment. Run
        // _sync() to update its value, and maybe also hide the slider if backlight
        // adjustment is unavailable on this machine.
        indicator._sync();
    }

    // Monkey-patched screenshot methods
    _enableScreenshotPatch() {
        const preHook = fname => {
            this._logger.log_debug('Screenshot ' + fname + '(): pre-capture')
            this._hideOverlays(false);
            this._stopCloningMouse();
            this._setPointerVisible(false);
        }
        const postHook = fname => {
            this._logger.log_debug('Screenshot ' + fname + '(): post-capture')
            this._on_brightness_change(false);
        }
        // Monkey-patch screenshot capture functions to remove the overlay during
        // area, desktop, and interactive screenshots.  This is unnecessary for
        // window screenshots, so skip the `screenshot_window` function.
        //
        // Note that in GS 3.38+, these screenshot functions return Promises:
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/1126
        // After dropping support for GS 3.36-, consider modifying Utils.patchFunction
        // to support both a pre-hook and a post-hook, using Promise's `then()` to
        // chain the post-hook function.
        this._logger.log_debug('_enableScreenshotPatch()');
        const proto = Shell.Screenshot.prototype;
        const targetFns = [
            'screenshot',
            'screenshot_area',
            ...proto.screenshot_stage_to_content ? ['screenshot_stage_to_content'] : []
        ];
        this._screenshotRevertFns = [
            ...targetFns.map(fname => Utils.patchFunction(proto, fname, preHook)),
            ...targetFns.map(fname => Utils.patchFunction(proto, fname + '_finish', postHook)),
        ];
    }

    _disableScreenshotPatch() {
        // Undo monkey-patching of screenshot functions
        this._logger.log_debug('_disableScreenshotPatch()');
        this._screenshotRevertFns.map(fn => fn());
        this._screenshotRevertFns = [];
    }

};
