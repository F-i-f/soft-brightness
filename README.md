# Soft Brightness Gnome Shell Extension
## Overview

Soft Brightness uses an alpha overlay to control the brightness on all
or some of your monitors.  It integrates smoothly
Common uses are:

- Your laptop has no backlight, maybe because it's not supported, or
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

## Download

Check-out the GitHub [releases page](https://github.com/F-i-f/soft-brightness/releases).

## Building from source

### Requirements

- [meson](http://mesonbuild.com/) v0.40.0 or later.

### Running the build

- Check out: `git clone https://github.com/F-i-f/soft-brightness`

- `cd soft-brightness`

- Run meson: `meson build`

- To install in your your gnome shell extensions's directory (~/.local/share/gnome-shell/extensions), run ninja: `ninja -C build install`

- To build the extension zip files, run: `ninja -C build extension.zip`, the extension will be found under `build/extension.zip`.

## Changelog

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
Let's call it release v2 then.

### Version 1
#### February 2, 2019

First public release.
