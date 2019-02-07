# gse-lib
# A Gnome Shell Extension library

## Overview

gse-lib contains various files needed when using meson for building 
Gnome Shell extensions.

This repository is supposed to be included in the `gse-lib` top-level 
directory of your extension (with git-subtree and/or git-submodule).

Then you can just create a `meson.build.gse-lib` file with:
```
extension_sources	  = [files('src/extension.js', 'src/prefs.js', 'other js files']
extension_libs		  = [extension_lib_convenience] # or other js libraries provided by gse-lib
extension_data		  = [files('src/stylesheet.css', 'other data files')] 
extension_schemas	  = [files('schemas/org.gnome.shell.extensions.'+ meson.project_name() + '.gschema.xml')]
extension_dbus_interfaces = [files('file to be included under the dbus-interface top-level directory of your extension')]
```
then run:
```
gse-lib/autogen-meson
```

and gse-lib will create a top-level `meson.build` file as well as a `po/meson.build` if the `po` top-level subdirectory
exists.

### Requirements

- [GNU m4](https://www.gnu.org/software/m4/m4.html)
