# Birdview.js

![Screenshot](birdview_banner.png)

**Get a glance at a whole web page with an aerial view.**

[**Demo & documentation**](https://www.achrafkassioui.com/birdview/)

## Setup

Include `birdview.js` and `birdview.css` in HTML:

```
<link rel="stylesheet" type="text/css" href="birdview.css"/>
<script type="text/javascript" src="birdview.js"></script>
```

Enable Birdview with the initialization method:

```
birdview.init();
```

## Usage

You can trigger birdview by either:

- **Pressing the Z key**
- **Pinch-in gesture** on a touch device

You can also trigger birdview by clicking any HTML element with a `birdview_toggle` class:

```
<button class="birdview_toggle">Birdview</button>
```

Or you can toggle birdview programmatically using the toggle method:

```
birdview.toggle();
```

You can stop birdview from running on your page by calling:

```
birdview.destroy();
```

The destruction method is called inside the initialization method. Calling `birdview.init()` multiple times shouldn't create any undesirable overlapping.
