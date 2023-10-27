// soft-brightness-plus - Control the display's brightness via an alpha channel.
// Copyright (C) 2019-2022 Philippe Troin (F-i-f on Github)
// Copyright (C) 2023 Joel Kitching (jkitching on Github)
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

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Utils from './utils.js';

export default class SoftBrightnessPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        return new PreferencesPage(this.getSettings(), this.metadata);
    }
}

const PreferencesPage = GObject.registerClass(class PreferencesPage extends Adw.PreferencesPage {
    constructor(settings, metadata) {
        super();

        this._settings = settings;
        this._metadata = metadata;

        {
            const group = new Adw.PreferencesGroup();

            this.title_label = new Gtk.Label({
                use_markup: true,
                label: '<span size="large" weight="heavy">'
                    +_('Soft Brightness Plus')+'</span>',
                hexpand: true,
                halign: Gtk.Align.CENTER,
            });
            group.add(this.title_label);

            const version_string = this._metadata['version'] + ' / git ' + this._metadata['vcs_revision'];
            this.version_label = new Gtk.Label({
                use_markup: true,
                label: '<span size="small">'+_('Version')
                    + ' ' + version_string + '</span>',
                hexpand: true,
                halign: Gtk.Align.CENTER,
            });
            group.add(this.version_label);

            this.link_label = new Gtk.Label({
                use_markup: true,
                label: '<span size="small"><a href="'+this._metadata.url+'">'
                    + this._metadata.url + '</a></span>',
                hexpand: true,
                halign: Gtk.Align.CENTER,
                margin_bottom: this.margin_bottom,
            });
            group.add(this.link_label);

            this.add(group);
        }

        {
            const group = new Adw.PreferencesGroup();

            this.enabled_control = new Adw.SwitchRow({
                title: _('Use backlight control:'),
                subtitle: this._getDescription('use-backlight'),
            });
            this._settings.bind('use-backlight', this.enabled_control, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(this.enabled_control);

            const monitors_model = new Gtk.StringList();
            monitors_model.append(_('All'));
            monitors_model.append(_('Built-in'));
            monitors_model.append(_('External'));
            this.monitors_control = new Adw.ComboRow({
                title: _('Monitor(s):'),
                subtitle: this._getDescription('monitors'),
                model: monitors_model,
            });
            this.monitors_control.connect('notify::selected', () => {
                this._settings.set_enum('monitors', this.monitors_control.selected);
            });
            this._settings.connect('changed::monitors', () => {
                this.monitors_control.set_selected(this._settings.get_enum('monitors'));
            });
            group.add(this.monitors_control);

            this.builtin_monitor_control = new Adw.ComboRow({
                title: _('Built-in monitor:'),
                subtitle: this._getDescription('builtin-monitor'),
            });
            Utils.newDisplayConfig(this._metadata['path'], (function(proxy, error) {
                if (error) {
                    console.log('Cannot get DisplayConfig: '+error);
                    return;
                }
                this.displayConfigProxy = proxy;
                this._bindBuiltinMonitorControl();
                this.displayConfigProxy.connectSignal('MonitorsChanged', this._refreshMonitors.bind(this));
                this._refreshMonitors();
            }).bind(this));
            group.add(this.builtin_monitor_control);

            this.add(group);
        }

        {
            const group = new Adw.PreferencesGroup({
                title: _('Full-screen behavior:'),
                description: this._getDescription('prevent-unredirect'),
            });
            const selected = this._settings.get_enum('prevent-unredirect')

            let row;

            row = new Adw.ActionRow({
                title: _('Do not enforce brightness in full-screen'),
            });
            const option0 = new Gtk.CheckButton();
            if (selected == 0)
                option0.set_active(true);
            row.add_prefix(option0);
            row.set_activatable_widget(option0);
            group.add(row);

            row = new Adw.ActionRow({
                title: _('Brightness enforced in full-screen'),
            });
            const option1 = new Gtk.CheckButton();
            if (selected == 1)
                option1.set_active(true);
            option1.set_group(option0);
            row.add_prefix(option1);
            row.set_activatable_widget(option1);
            group.add(row);

            row = new Adw.ActionRow({
                title: _('Brightness enforced in full-screen, always tear-free'),
            });
            const option2 = new Gtk.CheckButton();
            if (selected == 2)
                option2.set_active(true);
            option2.set_group(option0);
            row.add_prefix(option2);
            row.set_activatable_widget(option2);
            group.add(row);

            option0.connect('toggled', () => this._settings.set_enum('prevent-unredirect', 0));
            option1.connect('toggled', () => this._settings.set_enum('prevent-unredirect', 1));
            option2.connect('toggled', () => this._settings.set_enum('prevent-unredirect', 2));
            this._settings.connect('changed::prevent-unredirect', () => {
                if (this.processing_prevent_unredirect)
                    return;
                this.processing_prevent_unredirect = true;
                const selected = this._settings.get_enum('prevent-unredirect');
                const options = [option0, option1, option2];
                const cur = options.splice(selected, 1)[0];
                cur.set_active(true);
                options.forEach(option => option.set_active(false));
                this.processing_prevent_unredirect = false;
            });

            this.add(group);
        }

        {
            const group = new Adw.PreferencesGroup();

            this.min_brightness_control = new Adw.SpinRow({
                title: _('Minimum brightness (0..1):'),
                subtitle: this._getDescription('min-brightness'),
                digits: 2,
                adjustment: new Gtk.Adjustment({
                    lower: 0.0,
                    upper: 1.0,
                    step_increment: 0.01,
                }),
            });
            this._settings.bind('min-brightness', this.min_brightness_control, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(this.min_brightness_control);

            this.clone_mouse_control = new Adw.SwitchRow({
                title: _('Mouse cursor brightness control:'), 
                subtitle: this._getDescription('clone-mouse'),
            });
            this._settings.bind('clone-mouse', this.clone_mouse_control, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(this.clone_mouse_control);

            this.debug_control = new Adw.SwitchRow({
                title: _('Debug:'),
                subtitle: this._getDescription('debug'),
            });
            this._settings.bind('debug', this.debug_control, 'active', Gio.SettingsBindFlags.DEFAULT); 
            group.add(this.debug_control);

            this.add(group);
        }

        {
            const group = new Adw.PreferencesGroup();

            this.copyright_label = new Gtk.Label({
                use_markup: true,
                label: '<span size="small">'
                    + _('Copyright © 2019-2022 Philippe Troin (<a href="https://github.com/F-i-f">F-i-f</a> on GitHub)')
                    + '</span>',
                hexpand: true,
                halign: Gtk.Align.CENTER,
                margin_top: this.margin_bottom,
            });
            group.add(this.copyright_label);

            this.add(group);
        }
    }

    _getDescription(name) {
        return _(this._settings.settings_schema.get_key(name).get_description());
    }

    _bindBuiltinMonitorControl() {
        this.builtin_monitor_control_signal = this.builtin_monitor_control.connect('notify::selected', () => {
            this._settings.set_string('builtin-monitor', this.builtin_monitor_control.selected_item.string);
        });
        this.builtin_monitor_settings_signal = this._settings.connect('changed::builtin-monitor', () => {
            this._refreshMonitors();
        });
    }

    _unbindBuiltinMonitorControl() {
        this.builtin_monitor_control.disconnect(this.builtin_monitor_control_signal);
        this._settings.disconnect(this.builtin_monitor_settings_signal);
    }

    _refreshMonitors() {
        Utils.getMonitorConfig(this.displayConfigProxy, (function(result, error) {
            if (error) {
                console.log('Cannot get DisplayConfig: '+error);
                return;
            }
            const builtin_monitor_name = this._settings.get_string('builtin-monitor');
            const builtin_monitor_model = new Gtk.StringList();
            this._unbindBuiltinMonitorControl();
            let builtin_found = false;
            let builtin_idx = 0;
            for (let i=0; i < result.length; ++i) {
                let display_name = result[i][0];
                if (display_name == builtin_monitor_name) {
                    builtin_found = true;
                    builtin_idx = i;
                }
                builtin_monitor_model.append(display_name);
            }
            if (! builtin_found && builtin_monitor_name != '') {
                builtin_monitor_model.append(builtin_monitor_name);
                builtin_idx = result.length;
            }
            this.builtin_monitor_control.set_model(builtin_monitor_model);
            this.builtin_monitor_control.set_selected(builtin_idx);
            this._bindBuiltinMonitorControl();
        }).bind(this));
    }
});
