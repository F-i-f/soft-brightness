# meson-gse
# A Gnome Shell Extension library

## Overview

meson-gse contains various files needed when using meson for building
Gnome Shell extensions.

This repository is supposed to be included in the `meson-gse` top-level
directory of your extension (with git-subtree and/or git-submodule).

## Usage
### Expected layout
meson-gse expects your project to have a certain layout:
- `_<root directory>_/`
- `po/`
-- Internationalization files go here:
- `schemas/`
-- Any GSettings schema go here, they are expected to be of the form:
- `schemas/org.gnome.shell.extensions.`_your project name_`.gschema.xml` **[auto-included]**
- `src/`
-- javascript and css goes here
- `src/extension.js` This file is mandatory for a Gnome-shell extension.  **[auto-included]**
- `src/metadata.json.in` Mandatory template for the metadata file, see below.  **[auto-included]**
- `src/stylesheet.css` Optional **[auto-included]**
- `src/pref.js`  Optional. **[auto-included]**

### Import meson-gse in your git tree
In your extension's top-level directory, run:
``` shell
git subtree add -P meson-gse -m "Pull from meson-gse as a subtree." --squash git@github.com:F-i-f/meson-gse.git master
```
As a convenience, when pulling update from the project, two
commands automate pushing and pulling:

``` shell
meson-gse/git-subtree-pull
meson-gse/git-subtree-push
```

### Create required files
You need to create two files: `meson-gse.build` and `src/metadata.json.in`

#### The `meson-gse.build` file
##### Syntax
`# You can put a header here`
`# But no meson directives can be used`
`gse_project({`_extension name_`}, {`_extension uuid domain_`{`_extension version_`}, {`_gse assigments, meson code block_`})`
`# You can put other comments or meson directives after the gse_project statement`

- _extension name_ will be used as the _project name_ in the `meson_project()` definition and must conform to its requirements.
- _extension uuid domain_ will be appended to _extension name_ when generating the extension's UUID.
- _extension_version_ must be a single integer as it will be used in the Gnome Shell extension's `metadata.json` file.
- _gse_assigments, meson code block_ can be any meson code, but you're expected to fill in some meson-gse variables as described below.
##### Available meson-gse variables
- __gse_sources__
You can add any javascript files to this meson variable.  Note that the `src/extension.js` and `src/prefs.js` (if it exists) files are automatically included.
Example:
`gse_sources += files('src/other.js', 'src/foo.js')`
The `gse_sources` files are installed in the extension's root directory by the `install` or `extension.zip` `ninja` targets.
- __gse_libs__
This meson variable is intended for external javascript libraries.  The difference between `gse_sources` and `gse_libs` is that the `gse_sources` javascript files will be checked for syntax when running `ninja check` while the `gse_libs` javascript files won't.
The very commonly used `convenience.js` file is included in the meson-gse distribution and its path is available in the meson variable `gse_lib_convenience`.
A very [basic logging class](https://github.com/F-i-f/meson-gse/blob/master/lib/logger.js) is also provided, and its path is available in the `gse_lib_logger` meson variable.
Example:
`gse_libs += gse_lib_convenience`
`gse_libs += files('lib/other-library.js')`
The `gse_libs` files are installed in the extension's root directory by the `install` or `extension.zip` `ninja` targets.
- __gse_data__
This meson variable can be used for other non-javascript data files.  The `src/stylesheet.css` file is automatically included if it exists.
Example:
`gse_data += files('icons/blah.png', 'src/datafile.xml')`
The `gse_data` files are installed in the extension's root directory by the `install` or `extension.zip` `ninja` targets.
- __gse_schemas__
This meson variable can be used for GSettings schemas that need to be included.  If your extension's schema is stored in `schemas/org.gnome.shell.extensions.`_meson project name_`.gschema.xml`, it will be automatically included.
Example:
`gse_schemas += files('schemas/other-schema.xml')`
The `gse_data` files are installed in the extension's `schemas` directory by the `install` or `extension.zip` `ninja` targets.
- __gse_dbus_interfaces__
If your extension requires to be shipped with some missing or private DBus interfaces, you can use this meson variable.
Example:
`gse_dbus_interfaces += files('dbus-interfaces/private.xml')`
The `gse_dbus_interfaces` files are installed in the extension's `dbus-interfaces` directory by the `install` or `extension.zip` `ninja` targets.

#### The `src/metadata.json.in` file
This is a template for the extension's `metadata.json` file.
Meson will fill in some variables automagically.  All variables expansions are surrounded with `@` signs, like in `@variable@`.
##### Available `metadata.json.in`  expansions
- `@uuid@` fills in your extension's uuid.
- `@gettext_domain@` will be replaced by your extension's gettext domain.  This is typically your meson project name / extension name.
- `@version@` by your extension's version as declared in the `gse_project()` statement.
- `@VCS_TAG@` will be the current git revision number.

### Run the `meson-gse/meson-gse` tool, `meson` and `ninja`
```
meson-gse/meson-gse
meson build
ninja -C build install # Install to $HOME/.local/share/gnome-shell/extensions
ninja -C build extension.zip # Builds the extension in build/extension.zip
```

## Examples
### Simple project
I'm working on project _simple_, version _1_ and my extension's domain is `example.com`.
If your file layout is:
- `schemas/org.gnome.shell.extensions.simple.gschema.xml`
- `src/extension.js`
- `src/metadata.json.in`
- `src/prefs.js`

## Requirements

- [GNU m4](https://www.gnu.org/software/m4/m4.html)

## Credits

- I've been inspired by the
  [gnome-shell-extensions](https://gitlab.gnome.org/GNOME/gnome-shell-extensions/)
  for writing the meson build files.  Thanks to [Florian Müllner](https://gitlab.gnome.org/fmuellner).
- meson-gse includes the `convenience.js` file from Giovanni Campagna
  <scampa.giovanni@gmail.com>.
