# meson-gse

# A Gnome Shell Extension library

## Overview

meson-gse contains various files needed when using meson for building
Gnome Shell extensions.

This repository is supposed to be included in the `meson-gse`
top-level directory of your extension (with git-subtree and/or
git-submodule).

## Gnome Shell Extensions using meson-gse

- [SSH Search Provider Reborn](https://github.com/F-i-f/ssh-search-provider/)

- [Soft Brightness](https://github.com/F-i-f/soft-brightness/)

- [Tweaks in System Menu](https://github.com/F-i-f/tweaks-system-menu/)

- [Weeks Start on Monday Again...](https://github.com/F-i-f/weeks-start-on-monday/)

## Usage

### Expected layout

meson-gse expects your project to have a certain layout:

- `po/`

  - Internationalization files go here.

- `schemas/`

  - Any GSettings schema go here, they are expected to be of the form:

  - `schemas/org.gnome.shell.extensions.`_your project
	name_`.gschema.xml` **[auto-included]**

- `src/`

  - JavaScript and CSS goes here

  - `src/extension.js` This file is mandatory for a Gnome-shell
	extension.  **[auto-included]**

  - `src/metadata.json.in` Mandatory template for the metadata file,
	see below.  **[auto-included]**

  - `src/stylesheet.css` Optional. **[auto-included]**

  - `src/pref.js`  Optional. **[auto-included]**

### Import meson-gse in your git tree

In your extension's top-level directory, run:

```shell
git subtree add -P meson-gse -m "Pull from meson-gse as a subtree." git@github.com:F-i-f/meson-gse.git master
```

As a convenience, when pulling update from the project, two commands
automate pushing and pulling:

```shell
meson-gse/git-subtree-pull
meson-gse/git-subtree-push
```

### Create required files

You need to create two files: `meson-gse.build` and
`src/metadata.json.in`

#### The `meson-gse.build` file

##### Syntax

```shell
# You can put a header here
# But no meson directives can be used
gse_project({extension name}, {extension uuid domain}, {extension version}, {gse assignments, meson code block})
# You can put other comments or meson directives after the gse_project statement
```

- _extension name_ will be used as the _project name_ in the
  `meson_project()` definition and must conform to its requirements.

- _extension uuid domain_ will be appended to _extension name_ when
  generating the extension's UUID.

- _extension_version_ must be a single integer as it will be used in
  the Gnome Shell extension's `metadata.json` file.

- _gse_assignments, meson code block_ can be any meson code, but you're
  expected to fill in some meson-gse variables as described below.

##### Available meson-gse variables

- __gse_sources__

  You can add any JavaScript files to this meson variable.  Note that
  the `src/extension.js` and `src/prefs.js` (if it exists) files are
  automatically included.

  **Example:**

  ```meson
  gse_sources += files('src/other.js', 'src/foo.js')
  ```

  The `gse_sources` files are installed in the extension's root
  directory by the `install` or `extension.zip` `ninja` targets.

- __gse_libs__

  This meson variable is intended for external JavaScript libraries.
  The difference between `gse_sources` and `gse_libs` is that the
  `gse_sources` JavaScript files will be checked for syntax when
  running `ninja check` while the `gse_libs` JavaScript files won't.

  The very commonly used `convenience.js` file is included in the
  meson-gse distribution and its path is available in the meson
  variable `gse_lib_convenience`.

  A very [basic logging
  class](https://github.com/F-i-f/meson-gse/blob/master/lib/logger.js)
  is also provided, and its path is available in the `gse_lib_logger`
  meson variable.

  **Example:**

  ```meson
  gse_libs += gse_lib_convenience
  gse_libs += files('lib/other-library.js')
  ```

  The `gse_libs` files are installed in the extension's root directory
  by the `install` or `extension.zip` `ninja` targets.

- __gse_data__

  This meson variable can be used for other non-JavaScript data files.
  The `src/stylesheet.css` file is automatically included if it
  exists.

  **Example:**

  ```meson
  gse_data += files('icons/blah.png', 'src/datafile.xml')
  ```

  The `gse_data` files are installed in the extension's root directory
  by the `install` or `extension.zip` `ninja` targets.

- __gse_schemas__

  This meson variable can be used for GSettings schemas that need to
  be included.  If your extension's schema is stored in
  `schemas/org.gnome.shell.extensions.`_meson project
  name_`.gschema.xml`, it will be automatically included.

  **Example:**

  ```meson
  gse_schemas += files('schemas/other-schema.xml')
  ```

  The `gse_schemas` files are installed in the extension's `schemas`
  directory by the `install` or `extension.zip` `ninja` targets.

- __gse_dbus_interfaces__

  If your extension requires to be shipped with some missing or
  private DBus interfaces, you can use this meson variable.

  **Example:**

  ```meson
  gse_dbus_interfaces += files('dbus-interfaces/private.xml')
  ```

  The `gse_dbus_interfaces` files are installed in the extension's
  `dbus-interfaces` directory by the `install` or `extension.zip`
  `ninja` targets.

#### The `src/metadata.json.in` file

This is a template for the extension's `metadata.json` file.  Meson
will fill in some variables automatically.  All variables expansions
are surrounded with `@` signs, like in `@variable@`.

##### Available `metadata.json.in`  expansions

- `@uuid@` – fills in your extension's uuid.

- `@gettext_domain@` – will be replaced by your extension's gettext
  domain.  This is typically your meson project name / extension name.

- `@version@` – your extension's version as declared in the
  `gse_project()` statement.

- `@VCS_TAG@` – will be the current git revision number.

### Run the `meson-gse/meson-gse` tool, `meson` and `ninja`

```shell
meson-gse/meson-gse
meson build
ninja -C build test          # Checks syntax of JavaScript files
ninja -C build install       # Install to $HOME/.local/share/gnome-shell/extensions
ninja -C build extension.zip # Builds the extension in build/extension.zip
```

## Examples

### Simple project

I'm working on project _simple_, version _1_ and my extension's domain
is _example.com_.  If your file layout is:

- `meson-gse.build`

  ```meson
  meson_gse_project({simple}, {example.com}, {1})
  ```

- `src/extension.js`

   ```javascript
   const Extension = class Extension {
	 Name: 'Hello, world!',

	 enable: function() {
	   log('Hello world enabled');
	 },

	 disable: function() {
	   log('Hello world disabled');
	 }
   };

   function init() {
	 return new Extension();
   }
   ```

- `src/metadata.json.in`

   ```json
   {
	 "description": "Says: hello, world.",
	 "name": "Hello, world!",
	 "shell-version": [
	   "3.30"
	 ],
	 "gettext-domain": "@gettext_domain@",
	 "settings-schema": "org.gnome.shell.extensions.hello-world",
	 "url": "http://example.com/",
	 "uuid": "@uuid@",
	 "version": @version@,
	 "vcs_revision": "@VCS_TAG@"
   }
   ```

Create the two above files in a git repository:

```shell
mkdir hello-world
cd hello-world
git init
echo "gse_project({simple}, {example.com}, {1})" > meson-gse.build
mkdir src
cat <<-'EOD' > src/extension.js
	const Extension = class Extension {
	  Name: 'Hello, world!',

	  enable: function() {
		log('Hello world enabled');
	  },

	  disable: function() {
		log('Hello world disabled');
	  }
	});

	function init() {
	  return new Extension();
	}
EOD
cat <<-'EOD' > src/metadata.json.in
	{
	  "description": "Says: hello, world.",
	  "name": "Hello, world!",
	  "shell-version": [
		"3.30"
	  ],
	  "gettext-domain": "@gettext_domain@",
	  "settings-schema": "org.gnome.shell.extensions.hello-world",
	  "url": "http://example.com/",
	  "uuid": "@uuid@",
	  "version": @version@,
	  "vcs_revision": "@VCS_TAG@"
	}
EOD
git add meson-gse.build src
git commit -m "Initial checkin."
git subtree add -P meson-gse -m "Pull from meson-gse as a subtree." git@github.com:F-i-f/meson-gse.git master
meson-gse/meson-gse
meson build
ninja -C build test install
```

And your extension is installed and ready to be enabled in Tweaks.

### More complex examples

Refer to the [projects using meson-gse](#gnome-shell-extensions-using-meson-gse).

## Requirements

- [Meson](https://mesonbuild.com/) 0.50.0 or later.
- [GNU M4](https://www.gnu.org/software/m4/m4.html)

  M4 is needed to generate `meson.build` from `meson-gse.build`.

## Recent changes

### 2022-05-20

- Support js91 for javascript validation.
- Fix issue in git-subtree-push.

### 2021-12-20

- Fix compatibility issue with meson 0.60.
- Require meson 0.50.0 or later for builds.

## Credits

- I've been inspired by the
  [gnome-shell-extensions](https://gitlab.gnome.org/GNOME/gnome-shell-extensions/)
  for writing the meson build files.  Thanks to [Florian
  Müllner](https://gitlab.gnome.org/fmuellner).

- meson-gse includes the `convenience.js` file from Giovanni Campagna
  <scampa.giovanni@gmail.com>.

<!--  LocalWords:  gse subtree submodule GSettings CSS metadata uuid
LocalWords:  libs schemas dbus DBus gettext M4 Florian Müllner
LocalWords:  Campagna
-->
