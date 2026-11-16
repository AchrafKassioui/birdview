////////////////////////////////////////////////////////////////////////
//
// Birdview.js
// 2.2
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
    // Turning on scales the <body> with a CSS transform to fit the overlay.
    // The overlay sits in <html>, outside the <body>, so it isn't scaled.
    // Fixed elements fade out while on. Content or window changes zoom again.
    // Scrolling by hand turns it off.
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

    // Document bounds, measured on turning on
    var page = { top: 0, left: 0, extra: 0, extra_X: 0 };

    // Fade animations of fixed elements
    var fades = [];

    // Scroll position at the last zoom
    var zoom_scroll = { x: 0, y: 0 };

    // From turning on until fully zoomed back in. Used by the callbacks
    var away = false;

    // When Birdview last turned on
    var turned_on_at = 0;

    // Zoom spring: position, speed and target
    var spring = {
        now: { scale: 1, x: 0, y: 0 },
        speed: { scale: 0, x: 0, y: 0 },
        target: { scale: 1, x: 0, y: 0 },
        animations: []
    };

    // Wheel gestures: events less than 150ms apart. A gesture started before Birdview is ignored
    var wheel_gesture = { last: 0, began_before_birdview: false };

    var touch = {
        startX: 0,
        startY: 0,
        startSpan: 0,
        pinch: null,
        zoomed: false,
        count: 0,
        // When the finger touched the page
        began: 0,
        // Moved since touching: scroll, else tap
        moved: false
    };

    // Keys that turn Birdview off: arrows, space, page up and down, home, end, esc
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
        adaptive_button: true,  // light-on-dark button over dark content
        overlay: true,
        overlay_transition: 0.3,    // overlay fade, in seconds
        margin: 8,              // space around the overlay, in pixels
        stiffness: 700,         // zoom spring. 0 turns the animation off
        origin_X: 50,           // zoomed page position: 0 left, 50 center, 100 right
        fade_fixed: true,       // fade out fixed elements while on
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
        if(settings.adaptive_button) followBackdrop();
    }

    // Adaptive button: reads the background under the button
    var backdropWatcher = null;
    var backdropFrame = 0;

    function isDark(color){
        var parts = color.match(/[\d.]+/g);
        if(!parts || parts.length < 3) return null;
        if(parts.length > 3 && Number(parts[3]) < 0.5) return null;
        var luminance = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
        return luminance < 0.4;
    }

    function updateBackdrop(){
        backdropFrame = 0;
        if(!button || scaled) return;
        var box = button.getBoundingClientRect();
        var stack = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        var dark = false;
        for(var i = 0; i < stack.length; i++){
            if(stack[i] === button || (overlay && overlay.contains(stack[i]))) continue;
            var found = isDark(getComputedStyle(stack[i]).backgroundColor);
            if(found !== null){
                dark = found;
                break;
            }
        }
        button.classList.toggle('birdview_on_dark', dark);
    }

    function checkBackdrop(){
        if(!backdropFrame) backdropFrame = requestAnimationFrame(updateBackdrop);
    }

    function followBackdrop(){
        backdropWatcher = new MutationObserver(checkBackdrop);
        backdropWatcher.observe(html, {attributes: true, attributeFilter: ['class', 'style']});
        backdropWatcher.observe(body, {attributes: true, attributeFilter: ['class', 'style']});
        window.addEventListener('scroll', checkBackdrop, {passive: true});
        window.addEventListener('resize', checkBackdrop);
        window.addEventListener('load', checkBackdrop);
        document.addEventListener('transitionend', checkBackdrop);
        checkBackdrop();
    }

    function unfollowBackdrop(){
        if(backdropWatcher) backdropWatcher.disconnect();
        backdropWatcher = null;
        cancelAnimationFrame(backdropFrame);
        backdropFrame = 0;
        window.removeEventListener('scroll', checkBackdrop, {passive: true});
        window.removeEventListener('resize', checkBackdrop);
        window.removeEventListener('load', checkBackdrop);
        document.removeEventListener('transitionend', checkBackdrop);
    }

    function createOverlay(){
        overlay = document.createElement('div');
        overlay.id = 'birdview_auto_generated_overlay';
        overlay.style.setProperty('--birdview-fade', settings.overlay_transition + 's');
        overlay.style.setProperty('--birdview-margin', settings.margin + 'px');
        html.appendChild(overlay);
    }

    function removeInterface(){
        unfollowBackdrop();
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

        // Title and close button share one row
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

    // Measured untransformed: where the <body> starts, and how far the document extends past it
    function measurePage(){
        var rect = body.getBoundingClientRect();
        page.top = rect.top + window.scrollY;
        page.left = rect.left + window.scrollX;
        page.extra = Math.max(html.scrollHeight, body.scrollHeight) - (page.top + body.offsetHeight);
        page.extra_X = Math.max(html.scrollWidth, body.scrollWidth) - (page.left + body.offsetWidth);
    }

    // Document size. A transform doesn't change it
    function documentSize(){
        return {
            width: page.left + body.offsetWidth + page.extra_X,
            height: page.top + body.offsetHeight + page.extra
        };
    }

    // Visible area of the window. Follows the phone's toolbars and rotation
    function windowSize(){
        var visual = window.visualViewport;
        return visual ? { width: visual.width, height: visual.height } : { width: html.clientWidth, height: html.clientHeight };
    }

    // Zoom that fits the whole document in the overlay, never enlarged
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

    // Zoom back to the page as it is
    function pageZoom(){
        return { scale: 1, x: 0, y: 0 };
    }

    // Whether the browser's pinch zoom is at 1:1
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

    // A transform on the <body> breaks position: fixed, so fixed elements fade out while zoomed
    // See: https://www.achrafkassioui.com/blog/position-fixed-and-css-transforms/
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
            // Inside a fading fixed element
            if(faded.some(function(parent){ return parent.contains(element); })) return;
            faded.push(element);
            // Still fading in: turn around
            var fading = fades.filter(function(fade){ return fade.effect.target === element; })[0];
            if(fading){
                if(fading.playbackRate < 0) fading.reverse();
                return;
            }
            var fade = element.animate([{ opacity: 0 }], { duration: settings.overlay_transition * 1000, easing: 'ease', fill: 'forwards' });
            // Back in
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

    // Zoom to a target, from the current position and speed
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

    // Zoom at rest
    function render(){
        // Own layer while zoomed, so Chrome doesn't redraw the page
        body.style.willChange = 'transform';
        body.style.transformOrigin = '0 0';
        body.style.transition = 'none';
        body.style.transform = transformOf(spring.now);
    }

    // Critically damped spring: fastest arrival without overshoot
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

    // At rest once nothing moves by more than a fraction of a pixel
    function resting(state){
        var size = documentSize();
        var page_size = Math.max(size.width, size.height);
        for(var key in state.now){
            var pixels = key === 'scale' ? page_size : 1;
            if(Math.abs(state.now[key] - spring.target[key]) * pixels > 0.25 || Math.abs(state.speed[key]) * pixels > 5) return false;
        }
        return true;
    }

    // The browser plays the spring's path as one animation, 60 points a second
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
        // Final transform under the animation
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

    // Hold the spring where it is
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

    // Remove the transform once zoomed back in, so position: fixed works again
    function removeZoom(){
        stopSpring();
        body.style.transform = '';
        body.style.transition = '';
        body.style.transformOrigin = '';
        body.style.willChange = '';
        html.style.minHeight = '';
        html.style.minWidth = '';
    }

    // Scroll while zoomed, shifting the zoom so nothing moves on screen
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

    // A scroll not by hand moves the zoomed page: hold it still, then spring back
    function keepPageInView(){
        sync();
        spring.now.x += window.scrollX - zoom_scroll.x;
        spring.now.y += window.scrollY - zoom_scroll.y;
        applyZoom(birdviewZoom());
    }

    // Zoom at rest
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

    // Keep the document size while zoomed, so the scroll position doesn't move
    function holdScrollPosition(scroll){
        var size = windowSize();
        scroll = scroll || { x: window.scrollX, y: window.scrollY };
        html.style.minHeight = (scroll.y + size.height) + 'px';
        if(scroll.x) html.style.minWidth = (scroll.x + size.width) + 'px';
        updateLayout();
    }

    // Reading the height makes Safari apply the new size now
    function updateLayout(){
        return html.scrollHeight;
    }

    // Furthest scroll position
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
        // Still zooming back in: turn around
        if(!body.style.transform) measurePage();
        holdScrollPosition();
        scaled = true;
        turned_on_at = performance.now();
        holdFocus(true);
        toggleOverlay();
        fadeFixedElements(true);
        applyZoom(birdviewZoom());
        watch();
        // Never back to normal: one stay for the callbacks
        if(!away){
            away = true;
            if(settings.callback_start) settings.callback_start();
        }
    }

    // Zoom back in where the page was, or at its new end
    function exitBirdview(){
        if(!scaled) return;
        var furthest = furthestScroll();
        if(window.scrollX > furthest.x || window.scrollY > furthest.y){
            zoomInAt({ x: Math.min(window.scrollX, furthest.x), y: Math.min(window.scrollY, furthest.y) });
        }else{
            zoomInAt(null);
        }
    }

    // The page is inert under the overlay
    function holdFocus(on){
        if(on && !settings.overlay) return;
        body.inert = on;
    }

    // Turn off and zoom in
    function zoomInAt(scroll){
        scaled = false;
        holdFocus(false);
        unwatch();
        toggleOverlay();
        if(scroll) scrollAtOnce(scroll);
        applyZoom(pageZoom());
    }

    // Dive: zoom in on the point under the pointer
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

    // Sizes at the last zoom. Only real changes zoom again
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

    // Zoom again when the content or window changes
    function watch(){
        zoomed_for = sizes();
        zoomed_for_window = windowSizes();
        watcher = new ResizeObserver(rezoom);
        watcher.observe(body);
        window.addEventListener('resize', eventHandler, false);
        if(window.visualViewport) window.visualViewport.addEventListener('resize', eventHandler, false);
        document.addEventListener('wheel', blockMomentum, {passive: false});
    }

    function unwatch(){
        if(watcher) watcher.disconnect();
        watcher = null;
        window.removeEventListener('resize', eventHandler, false);
        if(window.visualViewport) window.visualViewport.removeEventListener('resize', eventHandler, false);
        document.removeEventListener('wheel', blockMomentum, {passive: false});
    }

    // Wheel blocking only while on, so normal scrolling never waits for Birdview
    function blockMomentum(e){
        if(wheel_gesture.began_before_birdview) e.preventDefault();
    }

    // Zoom again: at once for window resizes, with the spring for content changes
    function rezoom(){
        if(!scaled || sizes() === zoomed_for) return;
        var window_changed = windowSizes() !== zoomed_for_window;
        zoomed_for = sizes();
        zoomed_for_window = windowSizes();
        holdScrollPosition();
        var moving = spring.animations.length > 0;
        sync();
        if(window_changed){
            var zoom = birdviewZoom();
            spring.now = { scale: zoom.scale, x: zoom.x, y: zoom.y };
            spring.speed = { scale: 0, x: 0, y: 0 };
            spring.target = copy(spring.now);
            zoom_scroll = { x: window.scrollX, y: window.scrollY };
            render();
            // Settle a zoom cut short, so the menu shows
            if(moving) settle();
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

    // Tap or click in Birdview: links navigate, anything else dives. Returns whether it dived
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
            // Shortcut: no modifier, not while typing
            var modifiers = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;
            var typing = e.target.closest && e.target.closest('input:not([type=button]), textarea, select, [contenteditable]');
            if(e.keyCode == settings.shortcut && !modifiers && !e.repeat && !typing){
                birdview.toggle();
            }else if(scrolling_keys[e.keyCode]){
                exitBirdview();
            }
        }

        // The click that turned Birdview on doesn't dive
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

        // Scrolling by hand turns Birdview off
        if(e.type === 'wheel'){
            var now = performance.now();
            var new_gesture = now - wheel_gesture.last >= 150;
            wheel_gesture.last = now;
            if(new_gesture) wheel_gesture.began_before_birdview = false;
            // An earlier gesture's momentum doesn't turn Birdview off, see blockMomentum
            if(!wheel_gesture.began_before_birdview) exitBirdview();
        }

        if(e.type === 'mousedown' && e.button === 1){
            exitBirdview();
        }

        if(e.type === 'touchstart'){
            // Lifting taps, moving scrolls
            touch.moved = false;
            touch.began = e.timeStamp;

            // Inspired by reveal.js https://github.com/hakimel/reveal.js
            touch.startX = e.touches[0].clientX;
            touch.startY = e.touches[0].clientY;
            touch.count = e.touches.length;
            touch.pinch = null;
            // A gesture started on a zoomed page stays the browser's
            touch.zoomed = !atNativeScale();

            // Two touches: remember their distance
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

        // Tap: dive, and cancel the click that follows
        if(e.type === 'touchend' && scaled && touch.began >= turned_on_at && !touch.moved && touch.count === 1 && e.changedTouches.length === 1){
            if(tapInBirdview(e.target, touch.startX, touch.startY)) e.preventDefault();
        }

        if(e.type === 'touchmove'){
            // One finger: dive and keep scrolling
            if(scaled && touch.began >= turned_on_at && e.touches.length === 1 && touch.count === 1 && !touch.moved){
                touch.moved = true;
                if(!isPartOfLink(e.target) && !onOverlayControl(e.target)) dive(touch.startX, touch.startY);
                return;
            }
            touch.moved = true;

            // Pinch in: only from 1:1
            if(touch.zoomed || !atNativeScale()) return;

            // Direction is set after 4px and kept. Pinch out stays native
            if(e.touches.length === 2 && touch.count === 2){
                var currentSpan = distanceBetween({
                    x: e.touches[1].clientX,
                    y: e.touches[1].clientY
                },{
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                });
                var change = currentSpan - touch.startSpan;
                if(!touch.pinch && Math.abs(change) > 4) touch.pinch = change < 0 ? 'in' : 'out';

                // Past 30px: pinch in turns on, pinch out dives
                if(touch.pinch === 'in'){
                    e.preventDefault();
                    if(change < -30) enterBirdview();
                }else if(touch.pinch === 'out' && change > 30){
                    dive((e.touches[0].clientX + e.touches[1].clientX) * 0.5, (e.touches[0].clientY + e.touches[1].clientY) * 0.5);
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
        document.addEventListener('wheel', eventHandler, {passive: true});
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
        document.removeEventListener('wheel', eventHandler, {passive: true});
        document.removeEventListener('scroll', eventHandler, false);
        document.removeEventListener('mousedown', eventHandler, false);

        settings = null;
    };

    return birdview;
});
