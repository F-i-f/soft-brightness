// soft-brightness-plus - Control the display's brightness via an alpha channel.
// Copyright (C) 2019-2022 Philippe Troin (F-i-f on Github)
// Copyright (C) 2022-2023 Joel Kitching (jkitching on Github)
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
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import System from 'system';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Logger from './logger.js';
import * as Utils from './utils.js';
import { MouseSpriteContent } from './cursor.js';

export default class SoftBrightnessExtension extends Extension {
    constructor(...args) {
        super(...args);

        // Set/destroyed by enable/disable
        this._settings                                   = null;
        this._logger                                     = null;
        this._monitorManager                             = null;
        this._overlayManager                             = null;
        this._cursorManager                              = null;
        this._indicatorManager                           = null;
        this._screenshotManager                          = null;
        this._removeSettingsCallbacks                    = [];
    }

    // Base functionality: set-up and tear down logger, settings and debug setting monitoring
    enable() {
        this._settings = this.getSettings();
        this._logger = new Logger.Logger('soft-brightness-plus', this.metadata, Config.PACKAGE_VERSION);
        this._logger.set_debug(this._settings.get_boolean('debug'));
        this._logger.log_debug('enable(), session mode = '+Main.sessionMode.currentMode);
        this._logVersion();

        this._monitorManager = new MonitorManager(this._logger, this._settings, this.path);
        this._overlayManager = new OverlayManager(this._logger, this._settings, this._monitorManager);
        this._cursorManager = new CursorManager(this._logger, this._settings, this._overlayManager);
        this._indicatorManager = new IndicatorManager(this._logger);
        this._screenshotManager = new ScreenshotManager(this._logger);

        this._monitorManager.setChangeHook(() => {
            this._overlayManager.resetSize();
            this._on_brightness_change(true);
        });

        this._cursorManager.setChangeHook(() => {
            this._on_brightness_change(true);
        });

        this._indicatorManager.setBrightnessGetter(() => {
            this._on_brightness_change(false);
            return this._getBrightnessLevel();
        });

        this._indicatorManager.setBrightnessSetter((value) => {
            this._storeBrightnessLevel(value);
        });

        this._screenshotManager.setPreCaptureHook(() => {
            this._overlayManager.hideOverlays(false);
            this._cursorManager.stopCloning();
            // TODO: Double-check that this call is not needed.
            //this._cursorManager._setPointerVisible(false);
        });

        this._screenshotManager.setPostCaptureHook(() => {
            this._on_brightness_change(false);
        });

        this._monitorManager.enable();
        this._overlayManager.enable();
        this._cursorManager.enable();
        this._indicatorManager.enable();
        this._screenshotManager.enable();

        this._enableSettingsMonitoring();

        this._logger.log_debug('Extension enabled');
    }

    // In order to maintain the same brightness settings when the device is
    // locked and unlocked, "session-modes" includes "unlock-dialog" in
    // metadata.json.  The extension will remain active while the lock screen
    // is shown.
    disable() {
        this._logger.log_debug('disable(), session mode = '+Main.sessionMode.currentMode);

        this._monitorManager.disable();
        this._overlayManager.disable();
        this._cursorManager.disable();
        this._indicatorManager.disable();
        this._screenshotManager.disable();

        this._disableSettingsMonitoring();

        this._logger.log_debug('Extension disabled');

        this._settings                                   = null;
        this._logger                                     = null;
        this._monitorManager                             = null;
        this._overlayManager                             = null;
        this._cursorManager                              = null;
        this._indicatorManager                           = null;
        this._screenshotManager                          = null;
    }

    _logVersion() {
        const gnomeShellVersion = Config.PACKAGE_VERSION;
        if (gnomeShellVersion != undefined) {
            const splitVersion = gnomeShellVersion.split('.').map((x) => {
                x = Number(x);
                if (Number.isNaN(x)) {
                    return 0;
                } else {
                    return x;
                }
            });
            const major = splitVersion[0];
            const minor = splitVersion.length >= 2 ? splitVersion[1] : 0;
            const patch = splitVersion.length >= 3 ? splitVersion[2] : 0;
            const xdgSessionType = GLib.getenv('XDG_SESSION_TYPE');
            const onWayland = xdgSessionType == 'wayland';
            this._logger.log_debug('_logVersion(): gnome-shell version major='+major+', minor='+minor+', patch='+patch+', system_version='+System.version+', XDG_SESSION_TYPE='+xdgSessionType);
            this._logger.log_debug('_logVersion(): onWayland='+onWayland);
        }
    }

    _on_debug_change() {
        this._logger.set_debug(this._settings.get_boolean('debug'));
        this._logger.log('debug = '+this._logger.get_debug());
    }

    // Settings monitoring
    _enableSettingsMonitoring() {
        this._logger.log_debug('_enableSettingsMonitoring()');

        const callbacks = {
            'changed::min-brightness': () => this._on_brightness_change(false),
            'changed::current-brightness': () => this._on_brightness_change(false),
            'changed::monitors': () => this._on_brightness_change(true),
            'changed::builtin-monitor': () => this._on_brightness_change(true),
            'changed::use-backlight': () => this._on_use_backlight_change(),
            'changed::prevent-unredirect': () => this._on_brightness_change(true),
            'changed::debug': () => this._on_debug_change(),
        }
        this._removeSettingsCallbacks = Object.entries(callbacks).map(
            ([name, fn]) => {
                const conn = this._settings.connect(name, fn);
                return () => this._settings.disconnect(conn);
            }
        );
    }

    _disableSettingsMonitoring() {
        this._logger.log_debug('_disableSettingsMonitoring()');
        this._removeSettingsCallbacks.forEach((fn) => fn());
        this._removeSettingsCallbacks = [];
    }

    _on_brightness_change(force) {
        let curBrightness = this._getBrightnessLevel();
        let minBrightness = this._settings.get_double('min-brightness');

        this._logger.log_debug('_on_brightness_change: current-brightness='+curBrightness+', min-brightness='+minBrightness);
        if (curBrightness < minBrightness) {
            curBrightness = minBrightness;
            if (! this._settings.get_boolean('use-backlight')) {
                this._indicatorManager.setSliderValue(curBrightness);
            }
            this._storeBrightnessLevel(minBrightness);
            return;
        }
        if (curBrightness >= 1) {
            this._overlayManager.hideOverlays(false);
            this._cursorManager.stopCloning();
        } else {
            // Must be called before _showOverlays so that the overlay is on top.
            this._cursorManager.startCloning();
            this._overlayManager.showOverlays(curBrightness, force);
            // _showOverlays may not populate _overlays during initializations if we're waiting from the monitor list callback
            if (!this._overlayManager.initialized()) {
                this._cursorManager.stopCloning();
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

    // Utility functions to manage the stored brightness value.
    // If using the backlight, then we use the indicator as the brightness value store, which is linked to gsd.
    // If not using the backlight, the brightness is stored in the extension setting.
    _storeBrightnessLevel(value) {
        const proxy = this._indicatorManager.getProxy();
        if (this._settings.get_boolean('use-backlight') && proxy === null) {
            this._logger.log_debug('_storeBrightnessLevel still waiting for proxy...');
            return;
        }

        if (this._settings.get_boolean('use-backlight') && proxy.Brightness >= 0) {
            let convertedBrightness = Math.min(100, Math.round(value * 100.0));
            this._logger.log_debug('_storeBrightnessLevel('+value+') by proxy -> '+convertedBrightness);
            proxy.Brightness = convertedBrightness;
        } else {
            this._logger.log_debug('_storeBrightnessLevel('+value+') by setting');
            this._settings.set_double('current-brightness', value);
        }
    }

    _getBrightnessLevel() {
        const proxy = this._indicatorManager.getProxy();
        if (this._settings.get_boolean('use-backlight') && proxy === null) {
            this._logger.log_debug('_getBrightnessLevel still waiting for proxy...');
            return 0;
        }

        const proxyBrightness = proxy.Brightness;
        if (this._settings.get_boolean('use-backlight') && proxyBrightness >= 0) {
            const convertedBrightness = proxyBrightness / 100.0;
            this._logger.log_debug('_getBrightnessLevel() by proxy = '+convertedBrightness+' <- '+proxyBrightness);
            return convertedBrightness;
        } else {
            const brightness = this._settings.get_double('current-brightness');
            this._logger.log_debug('_getBrightnessLevel() by setting = '+brightness);
            return brightness;
        }
    }
}

// Monkey-patched screenshot methods
class ScreenshotManager {
    constructor(logger) {
        this._logger = logger;

        // Set/destroyed by _enableScreenshotPatch/_disableScreenshotPatch
        this._screenshotRevertFns                        = [];
    }

    setPreCaptureHook(fn) {
        this._preCaptureHookFn = fn;
    }

    setPostCaptureHook(fn) {
        this._postCaptureHookFn = fn;
    }

    enable() {
        const preCapture = (fname) => {
            this._logger.log_debug('Screenshot ' + fname + '(): pre-capture');
            if (this._preCaptureHookFn !== null) {
                this._preCaptureHookFn(fname);
            }
        };
        const postCapture = (fname) => {
            this._logger.log_debug('Screenshot ' + fname + '(): post-capture');
            if (this._postCaptureHookFn !== null) {
                this._postCaptureHookFn(fname);
            }
        };
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
            ...targetFns.map(fname => Utils.patchFunction(proto, fname, preCapture)),
            ...targetFns.map(fname => Utils.patchFunction(proto, fname + '_finish', postCapture)),
        ];
    }

    disable() {
        // Undo monkey-patching of screenshot functions
        this._logger.log_debug('_disableScreenshotPatch()');
        this._screenshotRevertFns.map(fn => fn());
        this._screenshotRevertFns = [];
    }
}

// Monkey-patched brightness indicator methods
class IndicatorManager {
    constructor(logger, settings) {
        this._logger = logger;
        this._settings = settings;

        this._enableTimeoutId                            = null;

        // Set/destroyed by _enable/_disable
        this._indicator                                  = null;
        this._slider                                     = null;
    }

    getProxy() {
        return this._indicator?._proxy;
    }

    setSliderValue(value) {
        if (this._slider !== null) {
            this._slider.value = value;
        }
    }

    enable() {
        // Subsequent 100ms checks: Wait until the _brightness object has been
        // set on quickSettings.
        const quickSettings = Main.panel.statusArea.quickSettings;
        let tries = 0;
        this._enableTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (tries >= 0 && quickSettings._brightness !== null) {
                this._logger.log_debug('Brightness slider ready, continue enable procedure');
                this._enableTimeoutId = null;
                this._enable();
                return GLib.SOURCE_REMOVE;
            }

            if (tries >= 5) {
                this._logger.log_debug('Giving up on brightness slider');
                this._enableTimeoutId = null;
                // TODO: Figure out how to disable the extension.
                return GLib.SOURCE_REMOVE;
            }

            tries += 1;
            if (tries >= 1)
                this._logger.log_debug('Brightness slider not ready, wait (attempt ' + tries + ')');
            return GLib.SOURCE_CONTINUE;
        });
    }

    setBrightnessGetter(fn) {
        this._getBrightnessFn = fn;
    }

    setBrightnessSetter(fn) {
        this._setBrightnessFn = fn;
    }

    _enable() {
        this._indicator = Main.panel.statusArea.quickSettings._brightness.quickSettingsItems[0];
        this._slider = this._indicator.slider;

        const indicator = this._indicator;
        const slider = this._slider;

        indicator.__orig__sliderChanged = indicator._sliderChanged;
        indicator._sliderChanged = () => {
            const value = slider.value;
            this._logger.log_debug('_sliderChanged(slide, '+value+')');
            if (this._setBrightnessFn !== null) {
                this._setBrightnessFn(value);
            }
        };
        slider.disconnect(indicator._sliderChangedId);
        indicator._sliderChangedId = slider.connect(
            'notify::value', indicator._sliderChanged.bind(indicator));

        indicator.__orig__sync = indicator._sync;
        indicator._sync = () => {
            this._logger.log_debug('_sync()');
            if (this._getBrightnessFn !== null) {
                slider.value = this._getBrightnessFn();
            }
        };

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

    disable() {
        // If _enableTimeoutId is non-null, _enable() has not run yet, and will
        // not run.  Do not run _disable() in this case.
        GLib.source_remove(this._enableTimeoutId);
        if (this._enableTimeoutId !== null)
            return;
        this._enableTimeoutId = null;

        if (this._indicator === null) return;

        const indicator = this._indicator;
        const slider = this._slider;

        indicator._sliderChanged = indicator.__orig__sliderChanged;
        slider.disconnect(indicator._sliderChangedId);
        indicator._sliderChangedId = slider.connect(
            'notify::value', indicator._sliderChanged.bind(indicator));
        delete indicator.__orig__sliderChanged;

        indicator._sync = indicator.__orig__sync;
        delete indicator.__orig__sync;

        this._indicator = null;
        this._slider = null;

        // If "use-backlight" is false and slider was being used for adjusting gamma,
        // slider will now revert to its previous use of backlight adjustment. Run
        // _sync() to update its value, and maybe also hide the slider if backlight
        // adjustment is unavailable on this machine.
        indicator._sync();
    }
}

// Cursor handling
class CursorManager {
    constructor(logger, settings, overlayManager) {
        this._logger = logger;
        this._settings = settings;
        this._overlayManager = overlayManager;

        this._enableTimeoutId                            = null;
        this._changeHookFn                               = null;

        this._cloneMouseSetting                          = null;
        this._cloneMouseSettingChangedConnection         = null;

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
    }

    setChangeHook(fn) {
        this._changeHookFn = fn;
    }

    enable() {
        // First 500ms: For some reason, starting the mouse cloning at this
        // stage fails when gnome-shell is restarting on x11 and the mouse
        // listener doesn't receive any events.  Adding a small delay before
        // starting the whole mouse cloning business helps.
        this._enableTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            // Wait 500ms before starting to check for the _brightness object.
            this._enableTimeoutId = null;
            this._enable();
            // Ensure proper stacking order for cursor and overlay.
            if (this._changeHookFn !== null) {
                this._changeHookFn();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _enable() {
        this._cloneMouseSetting = this._settings.get_boolean('clone-mouse');
        this._enableCloningMouse();
        this._cloneMouseSettingChangedConnection = this._settings.connect('changed::clone-mouse', this._on_clone_mouse_change.bind(this));
    }

    disable() {
        // If _enableTimeoutId is non-null, _enable() has not run yet, and will
        // not run.  Do not run _disable() in this case.
        GLib.source_remove(this._enableTimeoutId);
        if (this._enableTimeoutId !== null)
            return;
        this._enableTimeoutId = null;
        this._changeHookFn = null;

        this._settings.disconnect(this._cloneMouseSettingChangedConnection);
        this._cloneMouseSettingChangedConnection = null;
        this._disableCloningMouse();
        this._cloneMouseSetting = null;

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
    }

    startCloning() {
        if (this._cursorWantedVisible) {
            this._startCloningMouse();
        }
    }

    stopCloning() {
        this._stopCloningShowMouse();
    }

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
            if (this._changeHookFn !== null) {
                this._changeHookFn();
            }
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
            if (this._changeHookFn !== null) {
                this._changeHookFn();
            }
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

            this._overlayManager.addActor(this._cursorActor);
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

            this._overlayManager.removeActor(this._cursorActor);
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
        if (this._delayedSetPointerInvisibleIdleSource != null) {
            GLib.source_remove(this._delayedSetPointerInvisibleIdleSource);
            this._delayedSetPointerInvisibleIdleSource = null;
        }
    }
}

// Core functions to show & hide overlays
class OverlayManager {
    constructor(logger, settings, monitorManager) {
        this._logger = logger;
        this._settings = settings;
        this._monitorManager = monitorManager;

        this._overlays                                   = null;
        this._actorGroup                                 = null;
        this._actorAddedConnection                       = null;
        this._actorRemovedConnection                     = null;
    }

    enable() {
        this._actorGroup = new St.Widget({ name: 'soft-brightness-plus-overlays' });
        this.resetSize();
        Shell.util_set_hidden_from_pick(this._actorGroup, true);
        global.stage.add_actor(this._actorGroup);

        this._actorAddedConnection   = global.stage.connect('actor-added',   this._restackOverlays.bind(this));
        this._actorRemovedConnection = global.stage.connect('actor-removed', this._restackOverlays.bind(this));
    }

    disable() {
        global.stage.disconnect(this._actorAddedConnection);
        global.stage.disconnect(this._actorRemovedConnection);

        this._actorAddedConnection   = null;
        this._actorRemovedConnection = null;

        this.hideOverlays(true);
        this._overlays = null;

        global.stage.remove_actor(this._actorGroup);
        this._actorGroup.destroy();
        this._actorGroup = null;
    }

    resetSize() {
        this._actorGroup.set_size(global.screen_width, global.screen_height);
    }

    initialized() {
        return this._overlays !== null && this._overlays.length > 0;
    }

    addActor(actor) {
        this._actorGroup.add_actor(actor);
    }

    removeActor(actor) {
        // If we have already destroyed the actor group, its child actors
        // are already gone too.
        if (this._actorGroup) {
            this._actorGroup.remove_actor(actor);
        }
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

    showOverlays(brightness, force) {
        this._logger.log_debug('_showOverlays('+brightness+', '+force+')');
        if (this._overlays == null || force) {
            let monitors = this._monitorManager.getMonitors();
            if (force) {
                this.hideOverlays(false);
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

    hideOverlays(forceUnpreventUnredirect) {
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
}

// Monitor change handling
class MonitorManager {
    constructor(logger, settings, extPath) {
        this._logger = logger;
        this._settings = settings;
        this._extPath = extPath;

        this._monitorsChangedConnection = null;
        this._displayConfigProxy        = null;
        this._backendManager            = null;
        this._monitorNames              = null;
        this._changeHookFn              = null;
    }

    enable() {
        this._logger.log_debug('_enableMonitor2ing()');
        this._backendManager = global.backend.get_monitor_manager();
        Utils.newDisplayConfig(this._extPath, (function(proxy, error) {
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

    disable() {
        this._logger.log_debug('_disableMonitor2ing()');

        Main.layoutManager.disconnect(this._monitorsChangedConnection);

        this._logger = null;
        this._settings = null;

        this._monitorsChangedConnection = null;
        this._displayConfigProxy        = null;
        this._backendManager            = null;
        this._monitorNames              = null;
        this._changeHookFn              = null;
    }

    setChangeHook(fn) {
        this._changeHookFn = fn;
    }

    setPostCallback(callback) {
        this._postCallback = callback;
    }

    getMonitors() {
        let enabledMonitors = this._settings.get_string('monitors');
        let monitors;
        this._logger.log_debug('_showOverlays(): enabledMonitors="'+enabledMonitors+'"');
        if (enabledMonitors == 'all') {
            monitors = Main.layoutManager.monitors;
        } else if (enabledMonitors == 'built-in' || enabledMonitors == 'external') {
            if (this._monitorNames == null) {
                this._logger.log_debug('_showOverlays(): skipping run as _monitorNames hasn\'t been set yet.');
                return null;
            }
            let builtinMonitorName = this._settings.get_string('builtin-monitor');
            this._logger.log_debug('_showOverlays(): builtinMonitorName="'+builtinMonitorName+'"');
            if (builtinMonitorName == '' || builtinMonitorName == null) {
                builtinMonitorName = this._monitorNames[Main.layoutManager.primaryIndex];
                this._logger.log_debug('_showOverlays(): no builtin monitor, setting to "'+builtinMonitorName+'" and skipping run');
                this._settings.set_string('builtin-monitor', builtinMonitorName);
                return null;
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
            return null;
        }
        return monitors;
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
                let monitorIndex = this._backendManager.get_monitor_for_connector(connectorName);
                this._logger.log_debug('_on_monitors_change(): monitor="'+monitorName+'", connector="'+connectorName+'", index='+monitorIndex);
                if (monitorIndex >= 0) {
                    monitorNames[monitorIndex] = monitorName;
                }
            }
            this._monitorNames = monitorNames;
            if (this._changeHookFn !== null) {
                this._changeHookFn();
            }
        }).bind(this));
    }
}
