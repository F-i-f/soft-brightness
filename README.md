# Soft Brightness Gnome Shell Extension

![Brightness slider in Gnome Shell's system menu](docs/soft-brightness.png)

## Overview

Soft Brightness uses an alpha overlay to control the brightness on all
or some of your monitors.  It integrates smoothly
Common uses are:

- Your laptop has no back-light, maybe because it's not supported, or
  you have an OLED display.

- You want to control the brightness level of external monitor like
  you do with your built-in screen.

Bonus features:

- Minimum brightness level: do not get lost in the dark.

- Can operate the shell in tear-free (VSync) mode at all time.

## Configuration

Soft Brightness comes with a configuration panel, which can be
accessed from the "Tweaks" application or the [Gnome Shell Extensions
page](https://extensions.gnome.org/local/).

![Soft Brightness preference panel](docs/preferences.png)

## Download / Install

Install directly from the [Gnome Shell Extensions
site](https://extensions.gnome.org/extension/1625/soft-brightness/).

Or download the zip file from the GitHub [releases
page](https://github.com/F-i-f/soft-brightness/releases) and unzip
[the
file](https://github.com/F-i-f/soft-brightness/releases/download/v5/soft-brightness@fifi.org.v5.shell-extension.zip)
in your `~/.local/share/gnome-shell/extensions/` directory.

## Building from source

### Requirements

- [meson](http://mesonbuild.com/) v0.44.0 or later.

### Running the build

- Check out: `git clone https://github.com/F-i-f/soft-brightness`

- `cd soft-brightness`

- Run meson: `meson build`

- To install in your your gnome shell extensions' directory (~/.local/share/gnome-shell/extensions), run ninja: `ninja -C build install`

- To build the extension zip files, run: `ninja -C build extension.zip`, the extension will be found under `build/extension.zip`.

## Changelog

### Version 5
#### March 24, 2019

- Updated meson-gse to latest.
- Fix extension error on disable.
- Fix extension error on enable-disable-enable.
- Minor non-user visible, internal changes to preferences dialog.
- Minor doc updates.

### Version 4
#### February 11, 2019

- README.md: Meson 0.44.0 or later is required.
- README.md: Add credits.
- Drop duplicate shipped file in lib/convenience.js.
- Add GPLv3 in LICENSE.
- Use meson-gse for building: custom scripts moved there.
- Fix french translations not showing up.
- Beautify preferences dialog.
- Fix a few strings for consistency.
- Fix wrong gettext-domain in schema file.
- Remove all global variables from extension.

### Version 3
#### February 6, 2019

- Moved to git.
- Use meson for builds, restructure source tree.
- Added internationalization, and french translation.
- Added LICENSE and README.md files.
- Show git revision in debug logging.
- Brightness overlays now mask the entire desktop, including transients.
- Brightness overlays don't prevent DND actions in the overview anymore.
- Fix a couple of typos.

### Version 2
#### February 5, 2019

- The extension now removes the standard brightness control and puts its own in place (as opposed to trying to monkey patch the existing control).

- Handle external/built-in monitor.

- Control what happens in full-screen.

#### Notes

The git release shows as 3 in the source code, but the extension (as built by the [Gnome Shell Extensions website](https://extensions.gnome.org/)) shows the release at 2.
Let's call it release 2 then.

### Version 1
#### February 2, 2019

First public release.

## Credits

- The [`meson-gse` credits](https://github.com/F-i-f/meson-gse/) are
  included here by reference.

<!--  LocalWords:  OLED VSync extensions' Changelog README md GPLv3
LocalWords:  gse gettext DND
-->
