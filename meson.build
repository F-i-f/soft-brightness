# Boilerplate
project('soft-brightness',
	 version: '3',
	 meson_version: '>= 0.44.0',
	 license: 'GPL3' )

gettext_domain = meson.project_name()

gnome = import('gnome')
i18n  = import('i18n')

extension_uuid_suffix = '@fifi.org'

# Extension settings
extension_sources	  = [files('src/extension.js', 'src/prefs.js', 'src/utils.js')]
extension_libs		  = [files('lib/convenience.js')]
extension_data		  = [files('src/stylesheet.css')]
extension_schemas	  = [files('schemas/org.gnome.shell.extensions.'+ meson.project_name() + '.gschema.xml')]
extension_dbus_interfaces = [files('dbus-interfaces/org.gnome.Mutter.DisplayConfig.xml')]

# Boilerplate
run_home = run_command('sh', '-c', 'echo $HOME')
if run_home.returncode() != 0
  error('HOME not found, exit=@0@'.format(run_home.returncode()))
endif
home     = run_home.stdout().strip()

extension_uuid		       = meson.project_name() + extension_uuid_suffix
extension_target_dir	       = home + '/.local/share/gnome-shell/extensions/' + extension_uuid
extension_target_dir_schemas   = join_paths(extension_target_dir, 'schemas')
extension_target_locale_dir    = join_paths(extension_target_dir, 'locale')
extension_target_dir_dbus_intf = extension_target_dir

meson_extra_scripts            = 'meson-scripts'

extension_metadata_conf = configuration_data()
git_rev_cmd = run_command('git', 'rev-parse', 'HEAD')
if git_rev_cmd.returncode() != 0
  warning('git rev-parse exit=@0@'.format(git_rev_cmd.returncode()))
  extension_metadata_conf.set('VCS_TAG', 'unknown')
else
  extension_metadata_conf.set('VCS_TAG', git_rev_cmd.stdout().strip())
endif

extension_data += configure_file(input:         'src/metadata.json.in',
				 output:        'metadata.json',
				 configuration: extension_metadata_conf)

#extension_metadata = vcs_tag(command:  ['git', 'rev-parse', 'HEAD'],
#			     input:    files('metadata.json.in'),
#			     output:   'metadata.json',
#			     fallback: 'unknown')
#extension_data += extension_metadata

custom_target('gschemas.compiled',
	      build_by_default: true,
	      command:          ['sh', '-c', 'glib-compile-schemas --targetdir . $(dirname @INPUT0@)'],
	      input:            extension_schemas,
	      output:           'gschemas.compiled',
	      install:          true,
	      install_dir:      extension_target_dir_schemas)
install_data(extension_schemas,
	     install_dir: extension_target_dir_schemas)

install_data(extension_sources + extension_data + extension_libs,
	     install_dir: extension_target_dir)

install_data(extension_dbus_interfaces,
	     install_dir: extension_target_dir_dbus_intf)

custom_target('extension',
	      build_by_default: false,
	      install: false,
	      command: [files(join_paths(meson_extra_scripts, 'make-extension')), extension_target_dir, '@OUTDIR@', '@OUTPUT@'],
	      output:  'extension.zip')

subdir('po')
