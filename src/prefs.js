// Soft-brightness - Control the display's brightness via an alpha channel.
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

const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const Logger = Me.imports.logger;

const SoftBrightnessSettings = GObject.registerClass(class SoftBrightnessSettings extends Gtk.Grid {

    setup() {
	this.margin_top = 12;
	this.margin_bottom = this.margin_top;
	this.margin_start = 48;
	this.margin_end = this.margin_start;
	this.row_spacing = 6;
	this.column_spacing = this.row_spacing;
	this.orientation = Gtk.Orientation.VERTICAL;

	this._settings = ExtensionUtils.getSettings();
	this._logger = new Logger.Logger('Soft-Brightness/prefs');
	this._logger.set_debug(this._settings.get_boolean('debug'));

	let ypos = 1;
	let descr;

	this.title_label = new Gtk.Label({
	    use_markup: true,
	    label: '<span size="large" weight="heavy">'
		+_('Soft Brightness')+'</span>',
	    hexpand: true,
	    halign: Gtk.Align.CENTER
	});
	this.attach(this.title_label, 1, ypos, 2, 1);

	ypos += 1;

	this.version_label = new Gtk.Label({
	    use_markup: true,
	    label: '<span size="small">'+_('Version')
		+ ' ' + this._logger.get_version() + '</span>',
	    hexpand: true,
	    halign: Gtk.Align.CENTER,
	});
	this.attach(this.version_label, 1, ypos, 2, 1);

	ypos += 1;

	this.link_label = new Gtk.Label({
	    use_markup: true,
	    label: '<span size="small"><a href="'+Me.metadata.url+'">'
		+ Me.metadata.url + '</a></span>',
	    hexpand: true,
	    halign: Gtk.Align.CENTER,
	    margin_bottom: this.margin_bottom
	});
	this.attach(this.link_label, 1, ypos, 2, 1);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('use-backlight').get_description());
	this.enabled_label = new Gtk.Label({label: _("Use backlight control:"), halign: Gtk.Align.START});
	this.enabled_label.set_tooltip_text(descr);
	this.enabled_control = new Gtk.Switch({halign: Gtk.Align.END});
	this.enabled_control.set_tooltip_text(descr);
	this.attach(this.enabled_label,   1, ypos, 1, 1);
	this.attach(this.enabled_control, 2, ypos, 1, 1);
	this._settings.bind('use-backlight', this.enabled_control, 'active', Gio.SettingsBindFlags.DEFAULT);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('monitors').get_description());
	this.monitors_label = new Gtk.Label({label: _("Monitor(s):"), halign: Gtk.Align.START});
	this.monitors_label.set_tooltip_text(descr);
	this.monitors_control = new Gtk.ComboBoxText({halign: Gtk.Align.END});
	this.monitors_control.set_tooltip_text(descr);
	this.monitors_control.append("all", _("All"));
	this.monitors_control.append("built-in", _("Built-in"));
	this.monitors_control.append("external", _("External"));
	this._settings.bind('monitors', this.monitors_control, 'active-id', Gio.SettingsBindFlags.DEFAULT);
	this.attach(this.monitors_label,   1, ypos, 1, 1);
	this.attach(this.monitors_control, 2, ypos, 1, 1);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('builtin-monitor').get_description());
	this.builtin_monitor_label = new Gtk.Label({label: _("Built-in monitor:"), halign: Gtk.Align.START});
	this.builtin_monitor_label.set_tooltip_text(descr);
	this.builtin_monitor_control = new Gtk.ComboBoxText({halign: Gtk.Align.END});
	this.builtin_monitor_control.set_tooltip_text(descr);
	let builtin_monitor_name = this._settings.get_string('builtin-monitor');
	if (builtin_monitor_name != "") {
	    this.builtin_monitor_control.append(builtin_monitor_name, builtin_monitor_name);
	}
	this.displayConfigProxy = Utils.newDisplayConfig((function(proxy, error) {
	    if (error) {
		log("Cannot get DisplayConfig: "+error);
		return;
	    }
	    this.displayConfigProxy.connectSignal('MonitorsChanged', this._refreshMonitors.bind(this));
	    this._refreshMonitors();
	}).bind(this));
	this._bindBuiltinMonitorControl();
	this.attach(this.builtin_monitor_label,   1, ypos, 1, 1);
	this.attach(this.builtin_monitor_control, 2, ypos, 1, 1);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('prevent-unredirect').get_description());
	this.prevent_unredirect_label = new Gtk.Label({label: _("Full-screen behavior:"), halign: Gtk.Align.START});
	this.prevent_unredirect_label.set_tooltip_text(descr);
	this.prevent_unredirect_control = new Gtk.ComboBoxText({halign: Gtk.Align.END});
	this.prevent_unredirect_control.set_tooltip_text(descr);
	this.prevent_unredirect_control.append("never",           _("Do not enforce brightness in full-screen"));
	this.prevent_unredirect_control.append("when-correcting", _("Brightness enforced in full-screen"));
	this.prevent_unredirect_control.append("always",          _("Brightness enforced in full-screen, always tear-free"));
	this._settings.bind('prevent-unredirect', this.prevent_unredirect_control, 'active-id', Gio.SettingsBindFlags.DEFAULT);
	this.attach(this.prevent_unredirect_label,   1, ypos, 1, 1);
	this.attach(this.prevent_unredirect_control, 2, ypos, 1, 1);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('min-brightness').get_description());
	this.min_brightness_label = new Gtk.Label({label: _("Minimum brightness (0..1):"), halign: Gtk.Align.START});
	this.min_brightness_label.set_tooltip_text(descr);
	this.min_brightness_control = new Gtk.SpinButton({
	    halign: Gtk.Align.END,
	    digits: 2,
	    adjustment: new Gtk.Adjustment({
		lower: 0.0,
		upper: 1.0,
		step_increment: 0.01
	    })
	});
	this.min_brightness_control.set_tooltip_text(descr);
	this.attach(this.min_brightness_label,   1, ypos, 1, 1);
	this.attach(this.min_brightness_control, 2, ypos, 1, 1);
	this._settings.bind('min-brightness', this.min_brightness_control, 'value', Gio.SettingsBindFlags.DEFAULT);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('clone-mouse').get_description());
	this.debug_label = new Gtk.Label({label: _("Mouse cursor brightness control:"), halign: Gtk.Align.START});
	this.debug_label.set_tooltip_text(descr);
	this.debug_control = new Gtk.Switch({halign: Gtk.Align.END});
	this.debug_control.set_tooltip_text(descr);
	this.attach(this.debug_label,   1, ypos, 1, 1);
	this.attach(this.debug_control, 2, ypos, 1, 1);
	this._settings.bind('clone-mouse', this.debug_control, 'active', Gio.SettingsBindFlags.DEFAULT);

	ypos += 1;

	descr = _(this._settings.settings_schema.get_key('brightness-scroll').get_description());
	this.brightness_scroll_label = new Gtk.Label({label: _("Brightness Scroller"), halign: Gtk.Align.START});
	this.brightness_scroll_label.set_tooltip_text(descr);
	this.brightness_scroll_control = new Gtk.ComboBoxText({halign: Gtk.Align.END});
	this.brightness_scroll_control.set_tooltip_text(descr);
	this.brightness_scroll_control.append("none-scroll",   _("None"));
	this.brightness_scroll_control.append("button-scroll", _("Button"));
	this.brightness_scroll_control.append("panel-scroll",  _("Panel"));
	this._settings.bind('brightness-scroll', this.brightness_scroll_control, 'active-id', Gio.SettingsBindFlags.DEFAULT);
	this.attach(this.brightness_scroll_label,   1, ypos, 1, 1);
	this.attach(this.brightness_scroll_control, 2, ypos, 1, 1);

    ypos += 1;

	descr = _(this._settings.settings_schema.get_key('debug').get_description());
	this.debug_label = new Gtk.Label({label: _("Debug:"), halign: Gtk.Align.START});
	this.debug_label.set_tooltip_text(descr);
	this.debug_control = new Gtk.Switch({halign: Gtk.Align.END});
	this.debug_control.set_tooltip_text(descr);
	this.attach(this.debug_label,   1, ypos, 1, 1);
	this.attach(this.debug_control, 2, ypos, 1, 1);
	this._settings.bind('debug', this.debug_control, 'active', Gio.SettingsBindFlags.DEFAULT);

	ypos += 1;

	this.copyright_label = new Gtk.Label({
	    use_markup: true,
	    label: '<span size="small">'
		+ _('Copyright © 2019-2022 Philippe Troin (<a href="https://github.com/F-i-f">F-i-f</a> on GitHub)')
		+ '</span>',
	    hexpand: true,
	    halign: Gtk.Align.CENTER,
	    margin_top: this.margin_bottom
	});
	this.attach(this.copyright_label, 1, ypos, 2, 1);

	ypos += 1;
    }

    _bindBuiltinMonitorControl() {
	this._settings.bind('builtin-monitor', this.builtin_monitor_control, 'active-id', Gio.SettingsBindFlags.DEFAULT);
    }

    _unbindBuiltinMonitorControl() {
	Gio.Settings.unbind(this.builtin_monitor_control, 'active-id');
    }

    _refreshMonitors() {
	Utils.getMonitorConfig(this.displayConfigProxy, (function(result, error) {
	    if (error) {
		log("Cannot get DisplayConfig: "+error);
		return;
	    }
	    let builtin_monitor_name = this._settings.get_string('builtin-monitor');
	    this._unbindBuiltinMonitorControl();
	    this.builtin_monitor_control.remove_all();
	    let builtin_found = false;
	    for (let i=0; i < result.length; ++i) {
		let display_name = result[i][0];
		if (display_name == builtin_monitor_name) {
		    builtin_found = true;
		}
		this.builtin_monitor_control.append(display_name, display_name);
	    }
	    if (! builtin_found && builtin_monitor_name != "") {
		this.builtin_monitor_control.append(builtin_monitor_name, builtin_monitor_name);
	    }
	    this._bindBuiltinMonitorControl();
	}).bind(this));
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    let widget = new SoftBrightnessSettings();
    widget.setup();
    // show_all() is only available/necessary on GTK < 4.0.
    if (widget.show_all !== undefined) {
	widget.show_all();
    }

    return widget;
}
