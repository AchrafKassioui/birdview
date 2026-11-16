////////////////////////////////////////////////////////////////////////
//
// Birdview.js
// 2.1
// Current version: 16 Nov 2026
// First version: 20 May 2017
//
// www.achrafkassioui.com/birdview/
//
// Copyright (C) 2017 Achraf Kassioui
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or any
// later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// https://www.gnu.org/licenses/gpl-3.0.en.html
//
////////////////////////////////////////////////////////////////////////

(function(root, factory){
    if(typeof define === 'function' && define.amd){
        define([], function(){
            return factory(root);
        });
    }else if(typeof exports === 'object'){
        module.exports = factory(root);
    }else{
        root.birdview = factory(root);
    }
})(typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : this, function(window){
    'use strict';

    ////////////////////////////////////////////////////////////////////////
    //
    // How it works
    //
    // Birdview leaves the page as it is until it is turned on. Then it scales the <body> with a CSS transform,
    // so the whole document, margins included, fits inside the overlay. When it is turned off, the transform is removed.
    // The overlay lives outside the <body>, directly in <html>, so it is never scaled.
    // Elements fixed in the window, the button included, are left to the browser. By default they fade out while Birdview is on (see fadeFixedElements).
    //
    // While Birdview is on, it watches the size of the <body> and of the window: when the content or the window changes,
    // Birdview zooms again, on the new content, and the scroll position stays put. Scrolling by hand (wheel, keys) turns it off.
    //
    ////////////////////////////////////////////////////////////////////////

    var birdview = {};
    var settings;

    var html = document.documentElement;
    var body = document.body;
    var overlay;
    var button;

    var scaled = false;
    var watcher = null;

    // Where the document's content starts and how much it extends past the <body>, measured when Birdview turns on.
    var page = { top: 0, left: 0, extra: 0, extra_X: 0 };

    // The fade of each fixed element, while it fades out, stays out, or fades back in.
    var fades = [];

    // The scroll position when the last zoom was applied.
    var zoom_scroll = { x: 0, y: 0 };

    // From the moment Birdview turns on until the page is back to normal, zoomed back in. The callbacks mark this stay.
    var away = false;

    // When Birdview last turned on.
    var turned_on_at = 0;

    /*
    *
    * The zoom moves like a spring, not along a fixed curve. The spring knows where the <body>'s zoom is (scale and translation),
    * how fast it moves, and where it is going. A new target, at any moment,
    * takes over from the current position and speed, so the zoom can turn around or change course without a jump or a restart.
    *
    */
    var spring = {
        now: { scale: 1, x: 0, y: 0 },
        speed: { scale: 0, x: 0, y: 0 },
        target: { scale: 1, x: 0, y: 0 },
        animations: []
    };

    /*
    *
    * A wheel or trackpad gesture is a run of wheel events less than 150ms apart. A trackpad's momentum keeps it going after the fingers lift.
    * A gesture that started before Birdview turned on is ignored until it ends: only a new one turns Birdview off.
    *
    */
    var wheel_gesture = { last: 0, began_before_birdview: false };

    var touch = {
        startX: 0,
        startY: 0,
        startSpan: 0,
        count: 0,
        // When the finger touched the page. A touch that began before Birdview turned on isn't a touch in Birdview.
        began: 0,
        // Whether the finger moved since it touched the page in Birdview: then it scrolls, else it taps.
        moved: false
    };

    /*
    *
    * Keycodes that turn Birdview off. Most are scrolling related keys
    * left: 37, up: 38, right: 39, down: 40, spacebar: 32, pageup: 33, pagedown: 34, end: 35, home: 36, esc: 27
    *
    */
    var scrolling_keys = {37: 1, 38: 1, 39: 1, 40: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 27: 1};

    var supports = 'ResizeObserver' in window && 'closest' in Element.prototype;

    ////////////////////////////////////////////////////////////////////////
    //
    // Default settings
    //
    ////////////////////////////////////////////////////////////////////////

    var defaults = {
        shortcut: 90,           // Z
        button: true,
        button_text: 'Birdview',
        overlay: true,
        overlay_transition: 0.3,    // seconds the overlay takes to fade in, and to fade out
        margin: 8,              // space between the window's edges and the overlay, in pixels. The page shrinks to fit inside the overlay
        stiffness: 700,         // how hard the spring pulls the zoom to where it goes. 0 turns the animation off
        origin_X: 50,           // where the zoomed page sits across the overlay: 0 left, 50 center, 100 right
        fade_fixed: true,       // fade out elements with position: fixed while Birdview is on, and back in after
        callback_start: null,
        callback_end: null,
        touch: true
    };

    ////////////////////////////////////////////////////////////////////////
    //
    // User interface
    //
    ////////////////////////////////////////////////////////////////////////

    function createButton(){
        button = document.createElement('button');
        button.type = 'button';
        button.innerText = settings.button_text;
        button.id = 'birdview_auto_generated_button';
        button.classList.add('birdview_toggle');
        body.appendChild(button);
    }

    function createOverlay(){
        overlay = document.createElement('div');
        overlay.id = 'birdview_auto_generated_overlay';
        overlay.style.setProperty('--birdview-fade', settings.overlay_transition + 's');
        overlay.style.setProperty('--birdview-margin', settings.margin + 'px');
        html.appendChild(overlay);
    }

    function removeInterface(){
        if(button) button.remove();
        if(overlay) overlay.remove();
        button = null;
        overlay = null;
    }

    function toggleOverlay(){
        if(!settings.overlay) return;
        if(!scaled && settings.stiffness === 0) hideOverlay();
        else if(!scaled) fadeOverlay();
        else if(settings.stiffness === 0) buildMenu();
        else showLoading();
    }

    function fadeOverlay(){
        overlay.replaceChildren();
        overlay.classList.add('fading');
    }

    function showLoading(){
        overlay.classList.remove('fading');
        overlay.classList.add('show', 'zooming');
        overlay.replaceChildren();
        var header = document.createElement('div');
        header.className = 'birdview_header';
        var h1 = document.createElement('h1');
        h1.innerText = 'Zooming...';
        header.appendChild(h1);
        overlay.appendChild(header);
    }

    function buildMenu(){
        if(!overlay) return;
        overlay.classList.remove('zooming');
        overlay.classList.add('show');
        overlay.replaceChildren();

        // The title and the close button share one row, so the button is centered on the title whatever its font
        var header = document.createElement('div');
        header.className = 'birdview_header';
        var h1 = document.createElement('h1');
        h1.innerText = 'Birdview';
        header.appendChild(h1);

        var close = document.createElement('button');
        close.type = 'button';
        close.innerText = 'X';
        close.classList.add('birdview_toggle');
        header.appendChild(close);
        overlay.appendChild(header);

        var home = document.createElement('a');
        home.href = '/';
        home.innerText = 'Home';
        overlay.appendChild(home);

        if(location.pathname != '/'){
            overlay.appendChild(document.createTextNode('/'));
            var here = document.createElement('a');
            here.href = window.location.href;
            here.innerText = document.title;
                overlay.appendChild(here);
        }

        var span = document.createElement('span');
        span.innerHTML = 'Click to dive<br>Press Z or pinch to toggle birdview';
        overlay.appendChild(span);
    }

    function hideOverlay(){
        if(!overlay) return;
        overlay.classList.remove('show', 'zooming', 'fading');
        overlay.replaceChildren();
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // Measurements
    //
    ////////////////////////////////////////////////////////////////////////

    /*
    *
    * Measured while the page isn't transformed: where the <body> starts in the document, which includes a first element's
    * top margin collapsing through it, and how far the document extends past the <body>, below it and to its right.
    *
    */
    function measurePage(){
        var rect = body.getBoundingClientRect();
        page.top = rect.top + window.scrollY;
        page.left = rect.left + window.scrollX;
        page.extra = Math.max(html.scrollHeight, body.scrollHeight) - (page.top + body.offsetHeight);
        page.extra_X = Math.max(html.scrollWidth, body.scrollWidth) - (page.left + body.offsetWidth);
    }

    // The document's size, from the <body>'s layout size, which a transform doesn't change, so it stays right while zoomed.
    function documentSize(){
        return {
            width: page.left + body.offsetWidth + page.extra_X,
            height: page.top + body.offsetHeight + page.extra
        };
    }

    /*
    *
    * The area of the window the page is seen in. On a phone, the visual viewport follows the browser's toolbars and the device's rotation,
    * which the layout viewport doesn't. Without it, the scrollbar-free size of the window.
    *
    */
    function windowSize(){
        var visual = window.visualViewport;
        return visual ? { width: visual.width, height: visual.height } : { width: html.clientWidth, height: html.clientHeight };
    }

    /*
    *
    * The zoom that shows the whole document inside the overlay, its full width and its full height,
    * as a translation and a scale applied to the <body> from its top left corner. The document is scaled by whichever of its width or height is tighter,
    * and never enlarged. It is centered vertically, and placed across by origin_X.
    * Given a scale, the zoom that places the document at that scale, the same way.
    *
    */
    function birdviewZoom(scale){
        var size = windowSize();
        var document_size = documentSize();
        var margin = settings.margin;
        var box = { width: size.width - margin * 2, height: size.height - margin * 2 };
        if(scale === undefined) scale = Math.min(box.width / document_size.width, box.height / document_size.height, 1);
        var offset_X = margin + (box.width - document_size.width * scale) * settings.origin_X / 100;
        var offset_Y = margin + (box.height - document_size.height * scale) / 2;
        return {
            scale: scale,
            offset_X: offset_X,
            offset_Y: offset_Y,
            x: offset_X + page.left * scale - page.left + window.scrollX,
            y: offset_Y + page.top * scale - page.top + window.scrollY
        };
    }

    // The zoom back to the page as it is, where it is scrolled.
    function pageZoom(){
        return { scale: 1, x: 0, y: 0 };
    }

    /*
    *
    * Whether the browser's own pinch zoom is at rest, the page at 1:1. The visual viewport knows its scale whatever the device's orientation.
    * Browsers without it are taken to be at 1:1.
    *
    */
    function atNativeScale(){
        return !window.visualViewport || Math.abs(window.visualViewport.scale - 1) < 0.01;
    }

    function distanceBetween(a, b){
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // Fixed elements
    //
    ////////////////////////////////////////////////////////////////////////

    /*
    *
    * A transform on the <body> makes the <body> the box its fixed elements are positioned in, instead of the window.
    * See: https://www.achrafkassioui.com/blog/position-fixed-and-css-transforms/
    * So while the page is zoomed, its fixed elements sit on the page, sized and placed against the whole <body>, not on screen.
    * Birdview leaves them to the browser. It only fades them out as it zooms out, and back in once the page is back to normal.
    * The fade is an animation of their opacity, from their own to 0, so their styles are never touched. Reversing it turns it around midway.
    *
    */
    function fadeFixedElements(out){
        if(!settings.fade_fixed) return;
        if(!out){
            fades.forEach(function(fade){
                if(fade.playbackRate > 0) fade.reverse();
            });
            return;
        }
        var faded = [];
        Array.prototype.forEach.call(body.querySelectorAll('*'), function(element){
            var style = getComputedStyle(element);
            if(style.position !== 'fixed' || style.display === 'none') return;
            // Inside a fixed element already fading, it fades along
            if(faded.some(function(parent){ return parent.contains(element); })) return;
            faded.push(element);
            // Still fading back in: it turns around from where it is
            var fading = fades.filter(function(fade){ return fade.effect.target === element; })[0];
            if(fading){
                if(fading.playbackRate < 0) fading.reverse();
                return;
            }
            var fade = element.animate([{ opacity: 0 }], { duration: settings.overlay_transition * 1000, easing: 'ease', fill: 'forwards' });
            // Back in: the animation goes, and the element shows as it always did
            fade.onfinish = function(){
                if(fade.playbackRate > 0) return;
                fade.cancel();
                fades.splice(fades.indexOf(fade), 1);
            };
            fades.push(fade);
        });
    }

    function removeFades(){
        fades.forEach(function(fade){ fade.cancel(); });
        fades = [];
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // CSS transforms
    //
    ////////////////////////////////////////////////////////////////////////

    /*
    *
    * Zoom to a target. The spring takes it from where the zoom is now, at its current speed.
    *
    */
    function applyZoom(zoom){
        sync();
        zoom_scroll = { x: window.scrollX, y: window.scrollY };
        spring.target.scale = zoom.scale;
        spring.target.x = zoom.x;
        spring.target.y = zoom.y;
        play();
    }

    function transformOf(state){
        return 'translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.scale + ')';
    }

    // Shows the zoom at rest where the spring is.
    function render(){
        /*
        *
        * Keep the <body> on its own layer for as long as it is zoomed. When an animation ends, Chrome would otherwise draw the whole page again
        * from scratch, and show empty bands while it does.
        *
        */
        body.style.willChange = 'transform';
        body.style.transformOrigin = '0 0';
        body.style.transition = 'none';
        body.style.transform = transformOf(spring.now);
    }

    /*
    *
    * A critically damped spring: pulled toward its target by the stiffness, and slowed just enough to arrive as fast as it can without overshooting.
    * Where it is and how fast it goes, any time after it started, computed exactly.
    *
    */
    function springAt(time){
        var rate = Math.sqrt(settings.stiffness);
        var decay = Math.exp(-rate * time);
        var state = { now: {}, speed: {} };
        for(var key in spring.now){
            var offset = spring.now[key] - spring.target[key];
            var pull = spring.speed[key] + rate * offset;
            state.now[key] = spring.target[key] + (offset + pull * time) * decay;
            state.speed[key] = (spring.speed[key] - rate * pull * time) * decay;
        }
        return state;
    }

    // At rest once nothing on screen would move by more than a fraction of a pixel. A change of scale moves the far end of the page the most.
    function resting(state){
        var size = documentSize();
        var page_size = Math.max(size.width, size.height);
        for(var key in state.now){
            var pixels = key === 'scale' ? page_size : 1;
            if(Math.abs(state.now[key] - spring.target[key]) * pixels > 0.25 || Math.abs(state.speed[key]) * pixels > 5) return false;
        }
        return true;
    }

    /*
    *
    * The browser plays the spring, like it plays a CSS transition, away from the page's own work, so it stays smooth on long pages.
    * Birdview works out the spring's whole path, 60 points a second, and hands it to the browser as one animation.
    * When the target changes midway, Birdview takes where the spring is at that moment and how fast it goes, and hands over a new path from there.
    *
    */
    function play(){
        stopSpring();
        var path = [];
        var state = { now: spring.now, speed: spring.speed };
        if(settings.stiffness > 0){
            for(var time = 0; !resting(state) && time < 5; time += 1 / 60){
                state = springAt(time);
                path.push(state.now);
            }
        }
        if(path.length < 2){
            spring.now = copy(spring.target);
            spring.speed = { scale: 0, x: 0, y: 0 };
            render();
            return settle();
        }
        path[path.length - 1] = copy(spring.target);
        var timing = { duration: (path.length - 1) / 60 * 1000, easing: 'linear', fill: 'forwards' };
        // Under the animation, the <body> already has its final transform, so the page is right if anything ever stops it.
        body.style.transformOrigin = '0 0';
        body.style.transition = 'none';
        body.style.transform = transformOf(spring.target);
        var zoom = body.animate(path.map(function(point){ return { transform: transformOf(point) }; }), timing);
        spring.animations = [zoom];
        spring.started = zoom;
        zoom.onfinish = function(){
            if(spring.started !== zoom) return;
            stopSpring();
            spring.now = copy(spring.target);
            spring.speed = { scale: 0, x: 0, y: 0 };
            render();
            settle();
        };
    }

    // Takes where the spring is at this moment, and how fast it goes, and holds it there until it plays again.
    function sync(){
        if(!spring.animations.length) return;
        var state = springAt((spring.started.currentTime || 0) / 1000);
        spring.now = state.now;
        spring.speed = state.speed;
        stopSpring();
        render();
    }

    function stopSpring(){
        spring.animations.forEach(function(animation){ animation.cancel(); });
        spring.animations = [];
        spring.started = null;
    }

    function copy(state){
        var copied = {};
        for(var key in state) copied[key] = state[key];
        return copied;
    }

    /*
    *
    * Once zoomed back in, remove the transform entirely, so elements with fixed positioning work again
    * See: https://www.w3.org/TR/css-transforms-1/#propdef-transform
    * and: https://www.achrafkassioui.com/blog/position-fixed-and-css-transforms/
    *
    */
    function removeZoom(){
        stopSpring();
        body.style.transform = '';
        body.style.transition = '';
        body.style.transformOrigin = '';
        body.style.willChange = '';
        html.style.minHeight = '';
        html.style.minWidth = '';
    }

    /*
    *
    * Scroll the page to a place at once, while it is zoomed, and shift the zoom by as much, so nothing moves on screen.
    * The page is then really there: zooming in shows it, and a finger or wheel that keeps scrolling goes on from there.
    *
    */
    function scrollAtOnce(scroll){
        sync();
        var from = { x: window.scrollX, y: window.scrollY };
        holdScrollPosition(scroll);
        window.scrollTo(scroll.x, scroll.y);
        spring.now.x += window.scrollX - from.x;
        spring.now.y += window.scrollY - from.y;
        zoom_scroll = { x: window.scrollX, y: window.scrollY };
        render();
    }

    /*
    *
    * A scroll that isn't by hand (the scrollbar, the page itself) moves the zoomed page. Hold it still where it is seen, at once,
    * then let the spring take it to where it belongs.
    *
    */
    function keepPageInView(){
        sync();
        spring.now.x += window.scrollX - zoom_scroll.x;
        spring.now.y += window.scrollY - zoom_scroll.y;
        applyZoom(birdviewZoom());
    }

    // The zoom has come to rest.
    function settle(){
        if(scaled){
            buildMenu();
        }else{
            removeZoom();
            hideOverlay();
            fadeFixedElements(false);
            away = false;
            if(settings.callback_end) settings.callback_end();
        }
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // Birdview methods
    //
    ////////////////////////////////////////////////////////////////////////

    birdview.toggle = function(){
        !scaled ? enterBirdview() : exitBirdview();
    };

    /*
    *
    * A scaled down <body> makes the document smaller, so the browser would move the scroll position, shifting the zoomed page.
    * While Birdview is on, the document keeps the size it needs for the current scroll position, so the scroll position never moves.
    *
    */
    function holdScrollPosition(scroll){
        var size = windowSize();
        scroll = scroll || { x: window.scrollX, y: window.scrollY };
        html.style.minHeight = (scroll.y + size.height) + 'px';
        if(scroll.x) html.style.minWidth = (scroll.x + size.width) + 'px';
        updateLayout();
    }

    /*
    *
    * Safari may keep the document's old size until it next draws, and clamp a scroll made before that to the old size.
    * Reading the document's height makes the browser take on the new size now.
    *
    */
    function updateLayout(){
        return html.scrollHeight;
    }

    // The furthest the page can be scrolled, right and down.
    function furthestScroll(){
        var size = windowSize();
        var document_size = documentSize();
        return {
            x: Math.max(0, document_size.width - size.width),
            y: Math.max(0, document_size.height - size.height)
        };
    }

    function enterBirdview(){
        if(scaled) return;
        wheel_gesture.began_before_birdview = performance.now() - wheel_gesture.last < 150;
        /*
        *
        * Still zooming back in: turn around from where the page is, without waiting. The page is already measured,
        * and already scrolled where it zooms in.
        *
        */
        if(!body.style.transform) measurePage();
        holdScrollPosition();
        scaled = true;
        turned_on_at = performance.now();
        holdFocus(true);
        toggleOverlay();
        fadeFixedElements(true);
        applyZoom(birdviewZoom());
        watch();
        // Turned on again while still zooming back in, the page was never back to normal: the callbacks see one stay in Birdview.
        if(!away){
            away = true;
            if(settings.callback_start) settings.callback_start();
        }
    }

    /*
    *
    * Zoom back in where the page was. If the content got smaller meanwhile and that place is now past its end,
    * zoom in to the new end of the page instead.
    *
    */
    function exitBirdview(){
        if(!scaled) return;
        var furthest = furthestScroll();
        if(window.scrollX > furthest.x || window.scrollY > furthest.y){
            zoomInAt({ x: Math.min(window.scrollX, furthest.x), y: Math.min(window.scrollY, furthest.y) });
        }else{
            zoomInAt(null);
        }
    }

    /*
    *
    * While the overlay is shown, the page under it is inert: Tab moves only between the overlay's links and close button,
    * and the page's own links and fields can't take focus. Without the overlay, the zoomed page stays usable as it is.
    *
    */
    function holdFocus(on){
        if(on && !settings.overlay) return;
        body.inert = on;
    }

    // Turn Birdview off and zoom in, at a given place, or where the page is.
    function zoomInAt(scroll){
        scaled = false;
        holdFocus(false);
        unwatch();
        toggleOverlay();
        if(scroll) scrollAtOnce(scroll);
        applyZoom(pageZoom());
    }

    /*
    *
    * Dive: zoom in on the point under the pointer. The page is scrolled there at once, and zooms in there,
    * so the point stays under the pointer. A finger that keeps moving after the touch scrolls on from there.
    *
    */
    function dive(click_X, click_Y){
        if(!scaled) return;
        var zoom = birdviewZoom();
        var furthest = furthestScroll();
        var document_X = (click_X - zoom.offset_X) / zoom.scale;
        var document_Y = (click_Y - zoom.offset_Y) / zoom.scale;
        var place = {
            x: Math.min(Math.max(document_X - click_X, 0), furthest.x),
            y: Math.min(Math.max(document_Y - click_Y, 0), furthest.y)
        };
        zoomInAt(place);
    }

    // The sizes Birdview last zoomed for. Browsers report sizes that haven't changed (on watching, on some scrolls). Only real changes zoom again.
    var zoomed_for = null;
    var zoomed_for_window = null;

    function sizes(){
        var size = windowSize();
        return [body.offsetWidth, body.offsetHeight, size.width, size.height].join();
    }

    function windowSizes(){
        var size = windowSize();
        return [size.width, size.height].join();
    }

    // While Birdview is on, zoom again whenever the content or the window changes size, or the phone turns.
    function watch(){
        zoomed_for = sizes();
        zoomed_for_window = windowSizes();
        watcher = new ResizeObserver(rezoom);
        watcher.observe(body);
        window.addEventListener('resize', eventHandler, false);
        if(window.visualViewport) window.visualViewport.addEventListener('resize', eventHandler, false);
    }

    function unwatch(){
        if(watcher) watcher.disconnect();
        watcher = null;
        window.removeEventListener('resize', eventHandler, false);
        if(window.visualViewport) window.visualViewport.removeEventListener('resize', eventHandler, false);
    }

    /*
    *
    * Zoom again on the changed content or window.
    *
    * When the window changes size, someone is resizing it, or the phone is turning. The zoom follows the window at once, frame by frame,
    * so the page stays fitted to the window as it changes, with nothing catching up behind it.
    *
    * When only the content changes, for example a list being filtered, the spring takes the page to its new zoom, around the middle of what is seen:
    * first center the page again at the scale it has right now, at once, then zoom from there to the new scale.
    * Both are centered, so the page stays centered all the way, growing or shrinking around the middle of the window.
    *
    */
    function rezoom(){
        if(!scaled || sizes() === zoomed_for) return;
        var window_changed = windowSizes() !== zoomed_for_window;
        zoomed_for = sizes();
        zoomed_for_window = windowSizes();
        holdScrollPosition();
        sync();
        if(window_changed){
            var zoom = birdviewZoom();
            spring.now = { scale: zoom.scale, x: zoom.x, y: zoom.y };
            spring.speed = { scale: 0, x: 0, y: 0 };
            spring.target = copy(spring.now);
            zoom_scroll = { x: window.scrollX, y: window.scrollY };
            render();
            return;
        }
        var centered = birdviewZoom(spring.now.scale);
        spring.now.x = centered.x;
        spring.now.y = centered.y;
        applyZoom(birdviewZoom());
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // Event handler
    //
    ////////////////////////////////////////////////////////////////////////

    function isPartOfLink(target){
        return !!target.closest('a');
    }

    /*
    *
    * A tap or click in Birdview. The overlay's title turns Birdview off, and its links and buttons do their own thing.
    * On the page, a link navigates directly. Anything else dives, the overlay's background and even the page's own buttons:
    * too small to aim at, they are just part of the view. Returns whether it dived.
    *
    */
    function tapInBirdview(target, X, Y){
        if(onOverlayControl(target)){
            if(target.closest('h1')) birdview.toggle();
            return false;
        }
        if(isPartOfLink(target)) return false;
        dive(X, Y);
        return true;
    }

    function onOverlayControl(target){
        return !!(overlay && overlay.contains(target) && target.closest('h1, a, button'));
    }

    function eventHandler(e){
        if(e.type === 'resize') rezoom();

        if(e.type === 'keydown'){
            // The shortcut fires only on a fresh press with no modifier (so Cmd+Z stays undo), and never while typing in a field.
            var modifiers = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;
            var typing = e.target.closest && e.target.closest('input:not([type=button]), textarea, select, [contenteditable]');
            if(e.keyCode == settings.shortcut && !modifiers && !e.repeat && !typing){
                birdview.toggle();
            }else if(scrolling_keys[e.keyCode]){
                exitBirdview();
            }
        }

        /*
        *
        * A click that turned Birdview on, from the page's own button for example, is still on its way up when Birdview is on.
        * It isn't a click in Birdview, so it doesn't dive.
        *
        */
        if(e.type === 'click' && e.timeStamp < turned_on_at) return;

        if(e.type === 'click'){
            if(scaled && !onOverlayControl(e.target)){
                tapInBirdview(e.target, e.clientX, e.clientY);
            }else if(e.target.closest('.birdview_toggle')){
                birdview.toggle();
            }else if(scaled){
                tapInBirdview(e.target, e.clientX, e.clientY);
            }
        }

        if(e.type === 'scroll'){
            if(scaled) keepPageInView();
        }

        // Scrolling by hand turns Birdview off.
        if(e.type === 'wheel'){
            var now = performance.now();
            var new_gesture = now - wheel_gesture.last >= 150;
            wheel_gesture.last = now;
            if(new_gesture) wheel_gesture.began_before_birdview = false;
            // While the earlier gesture glides on, keep it from scrolling the zoomed page
            if(wheel_gesture.began_before_birdview && scaled) e.preventDefault();
            else exitBirdview();
        }

        if(e.type === 'mousedown' && e.button === 1){
            exitBirdview();
        }

        if(e.type === 'touchstart'){
            // A touch in Birdview does nothing yet. Lifting the finger taps, moving it scrolls.
            touch.moved = false;
            touch.began = e.timeStamp;

            // The multi-touch handling is inspired by reveal.js https://github.com/hakimel/reveal.js
            touch.startX = e.touches[0].clientX;
            touch.startY = e.touches[0].clientY;
            touch.count = e.touches.length;

            // With two touches, memorize the distance between them to detect pinching
            if(e.touches.length === 2){
                touch.startSpan = distanceBetween({
                    x: e.touches[1].clientX,
                    y: e.touches[1].clientY
                },{
                    x: touch.startX,
                    y: touch.startY
                });
            }
        }

        /*
        *
        * A finger lifted in Birdview without moving is a tap. It dives right away, and the click the browser would send after is cancelled,
        * so it can't press whatever is under the finger once zoomed in. Links and the overlay's buttons keep their click.
        *
        */
        if(e.type === 'touchend' && scaled && touch.began >= turned_on_at && !touch.moved && touch.count === 1 && e.changedTouches.length === 1){
            if(tapInBirdview(e.target, touch.startX, touch.startY)) e.preventDefault();
        }

        if(e.type === 'touchmove'){
            /*
            *
            * One finger moving in Birdview scrolls: dive where it first touched, and let the browser scroll on from there, in the same gesture.
            *
            */
            if(scaled && touch.began >= turned_on_at && e.touches.length === 1 && touch.count === 1 && !touch.moved){
                touch.moved = true;
                if(!isPartOfLink(e.target) && !onOverlayControl(e.target)) dive(touch.startX, touch.startY);
                return;
            }
            touch.moved = true;

            /*
            *
            * A pinch in should trigger Birdview, without breaking the native pinch to zoom:
            * only proceed if the page is at 1:1.
            *
            */
            if(!atNativeScale()) return;

            // If the touch started with two points and still has two, test for the pinch gesture
            if(e.touches.length === 2 && touch.count === 2){
                var currentSpan = distanceBetween({
                    x: e.touches[1].clientX,
                    y: e.touches[1].clientY
                },{
                    x: touch.startX,
                    y: touch.startY
                });

                // Pinching in: disable the default browser behavior
                if(currentSpan <= touch.startSpan){
                    e.preventDefault();
                }

                // Past 30 pixels: pinching in turns Birdview on. Pinching out dives into the midpoint between the two touches
                if(Math.abs(touch.startSpan - currentSpan) > 30){
                    if(currentSpan < touch.startSpan){
                        enterBirdview();
                    }else{
                        dive((touch.startX + e.touches[1].clientX) * 0.5, (touch.startY + e.touches[1].clientY) * 0.5);
                    }
                }
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////
    //
    // Initialize
    //
    ////////////////////////////////////////////////////////////////////////

    function extend(defaults, options){
        var extended = {};
        var prop;
        for(prop in defaults){
            if(Object.prototype.hasOwnProperty.call(defaults, prop)) extended[prop] = defaults[prop];
        }
        for(prop in options){
            if(Object.prototype.hasOwnProperty.call(options, prop)) extended[prop] = options[prop];
        }
        return extended;
    }

    birdview.init = function(options){
        if(!supports) return console.log('Birdview is not supported on this browser');
        birdview.destroy();
        settings = extend(defaults, options || {});
        if(settings.button) createButton();
        if(settings.overlay) createOverlay();

        if(settings.touch){
            document.addEventListener('touchstart', eventHandler, false);
            document.addEventListener('touchmove', eventHandler, {passive: false, capture: false});
            document.addEventListener('touchend', eventHandler, {passive: false, capture: false});
        }

        document.addEventListener('keydown', eventHandler, false);
        document.addEventListener('click', eventHandler, false);
        document.addEventListener('wheel', eventHandler, {passive: false});
        document.addEventListener('scroll', eventHandler, false);
        document.addEventListener('mousedown', eventHandler, false);
    };

    ////////////////////////////////////////////////////////////////////////
    //
    // Destroy
    //
    ////////////////////////////////////////////////////////////////////////

    birdview.destroy = function(){
        if(!settings) return;
        unwatch();
        scaled = false;
        away = false;
        body.inert = false;
        removeZoom();
        removeFades();
        removeInterface();

        if(settings.touch){
            document.removeEventListener('touchstart', eventHandler, false);
            document.removeEventListener('touchmove', eventHandler, {passive: false, capture: false});
            document.removeEventListener('touchend', eventHandler, {passive: false, capture: false});
        }

        document.removeEventListener('keydown', eventHandler, false);
        document.removeEventListener('click', eventHandler, false);
        document.removeEventListener('wheel', eventHandler, {passive: false});
        document.removeEventListener('scroll', eventHandler, false);
        document.removeEventListener('mousedown', eventHandler, false);

        settings = null;
    };

    return birdview;
});
