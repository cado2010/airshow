# AirShow - Real-Time Aircraft Ceiling Projection System

## Project Vision

AirShow is a real-time aircraft visualization system that transforms a room ceiling into a live view of the sky.

Unlike traditional flight trackers, AirShow presents aircraft as realistic moving objects projected onto a ceiling or wall, creating the illusion that the roof has disappeared and the user is looking directly at the sky above.

The application supports:

* Real-time aircraft tracking
* Ceiling projection mode
* Realistic 3D aircraft rendering
* Airline liveries and logos
* Aircraft-type recognition
* Free-camera exploration
* Aircraft chase mode
* Historical replay
* Spotter-style aircraft discovery

The application should run locally and use free ADS-B data sources.

---

# Core Design Principles

1. Must feel magical rather than technical.
2. Ceiling mode is the primary experience.
3. Aircraft should never appear as tiny dots.
4. Users should immediately recognize:

   * Aircraft type
   * Airline
   * Relative altitude
5. Smooth motion is more important than perfect accuracy.
6. Entire application should work without subscriptions.

---

# Data Sources

## Primary ADS-B Sources

Preferred order:

1. ADSB.lol
2. adsb.fi
3. Airplanes.live

Must support:

* Latitude
* Longitude
* Altitude
* Heading
* Ground speed
* Vertical rate
* Callsign
* Aircraft type
* ICAO identifier

---

# User Configuration

The application must NOT depend on the user's physical location.

Users specify:

```json
{
  "centerLat": 33.1976,
  "centerLon": -96.6153,
  "radiusMiles": 50,
  "refreshSeconds": 5
}
```

Examples:

* User home
* DFW Airport
* Heathrow
* JFK
* Bangalore
* Anywhere on Earth

---

# Display Modes

## Mode 1 - Ceiling Mode (Primary)

This is the flagship experience.

### Concept

Aircraft appear at their real position in the sky relative to the configured latitude and longitude.

Do NOT render a traditional radar display.

Example:

If an aircraft is north of the user:

* It appears toward the north side of the ceiling.

If an aircraft is east:

* It appears toward the east side of the ceiling.

Goal:

Create the illusion that the roof has disappeared.

---

## Ceiling Mode Background

Background:

* Pure black

Overlay:

* Very faint radar aesthetic

Include:

* Concentric range rings
* Crosshairs
* Compass labels

Example:

N

W + E

S

Optional:

* Slow rotating radar sweep
* User configurable

Opacity:

10% to 20% maximum

Aircraft must remain the primary visual focus.

---

# Aircraft Positioning

Convert:

```text
lat/lon
```

into local sky coordinates centered on:

```text
centerLat
centerLon
```

Terrain:

Ignored

Earth curvature:

Ignored

For a 50-mile radius the simplification is acceptable.

---

# Altitude Visualization

Altitude affects:

1. Aircraft size
2. Brightness
3. Opacity

Altitude must NOT cause aircraft to disappear.

### Important

A 38,000-foot aircraft must still be clearly visible.

Never render aircraft as points.

Use a clamped scaling system.

Example display sizes:

0-3,000 ft

90-110 px

3,000-10,000 ft

70-90 px

10,000-25,000 ft

50-70 px

25,000-45,000 ft

32-50 px

Minimum rendered size:

34 px

Recommended implementation:

Use a non-linear scale.

---

# Aircraft Type Recognition

Translate ICAO type codes into aircraft classes.

Examples:

A388 → Airbus A380

B744 → Boeing 747

B748 → Boeing 747-8

B738 → Boeing 737-800

A320 → Airbus A320

E75L → Embraer 175

---

# Aircraft Model Classes

V1 uses simplified classes.

Classes:

* Jumbo Widebody
* Widebody Twin
* Narrowbody
* Regional Jet
* General Aviation
* Helicopter
* Military
* Unknown

Architecture must support future expansion to individual aircraft types.

---

# Aircraft Visual Differentiation

Every aircraft should communicate:

* Airline
* Aircraft type
* Altitude

without requiring labels.

Use multiple visual cues.

---

## Airline Logos

Render:

1. Belly logo
2. Tail logo

Visible from below.

Example:

American Airlines

* Belly logo
* Tail logo

Delta

* Belly logo
* Tail logo

United

* Belly logo
* Tail logo

---

## Logo Storage

Do NOT hotlink logos.

Download once.

Store locally.

Suggested sources:

* ICAO-keyed SVG repositories
* Airline logo packages

Lookup flow:

callsign

↓

operator ICAO

↓

local logo cache

↓

render

Fallback:

Generic aircraft icon

---

## Aircraft Silhouettes

Aircraft shape is the primary identifier.

Examples:

A380

* Double deck
* Four engines

747

* Upper deck hump

787

* Long swept wings

737

* Compact narrowbody

E175

* Small regional jet

Cessna

* Propeller aircraft

Helicopter

* Rotorcraft silhouette

---

## Aircraft Class Colors

Use pale desaturated colors.

Jumbo Widebody

Pale Gold

Widebody Twin

Pale Blue

Narrowbody

Pale Silver

Regional Jet

Pale Green

Cargo

Pale Purple

General Aviation

Pale White

Helicopter

Pale Orange

Military

Pale Gray-Green

Unknown

Pale Gray

Colors should be subtle.

This is not a game UI.

---

# Navigation Lights

Night mode only.

Include:

* Red left wing light
* Green right wing light
* White tail light
* Flashing red beacon
* Flashing white strobes

---

# Contrails

Altitude > 30,000 ft

Render:

* Faint contrail

Altitude < 20,000 ft

No contrail

---

# Aircraft Trails

Trail lengths:

* 30 seconds
* 2 minutes (default)
* 5 minutes

Color modes:

* Airline color
* Altitude color
* Speed color

---

# Aircraft Labels

Default:

Hidden

Hover:

Show:

* Callsign
* Airline
* Aircraft type
* Altitude
* Ground speed
* Heading

---

# Fly-By Labels

Even when not hovering:

Every few seconds:

Random visible aircraft may briefly display:

AAL123
B738
34,000 ft

Then fade away.

Purpose:

Provide life and context.

---

# New Aircraft Spotter Effect

When an aircraft first enters monitored airspace:

Render:

* Soft red pulsing circle around aircraft

Duration:

3 to 5 seconds

Purpose:

Draw attention to new traffic.

---

# Rare Aircraft Highlighting

Optional setting.

Highlight:

* A380
* 747
* Military traffic
* Special aircraft

Use:

Subtle gold outline

---

# Aircraft Motion

ADS-B does not provide full attitude.

Estimate:

* Roll
* Pitch
* Yaw

using historical positions.

---

## Yaw

Calculate from:

* Heading
* Movement direction

---

## Pitch

Calculate from:

Altitude change

vs

Horizontal movement

---

## Roll

Calculate from:

Heading change rate

and

Ground speed

Estimate bank angle.

Clamp:

±35°

---

## Motion Smoothing

Interpolate:

* Position
* Altitude
* Roll
* Pitch
* Yaw

Goals:

* Smooth movement
* No jitter
* Natural flight

---

# Mode 2 - Free 3D Mode

Built using:

* Three.js
* WebGL

Users can freely navigate airspace.

Controls:

W/S

Forward/Back

A/D

Left/Right

Q/E

Down/Up

Mouse

Look Around

---

# 3D Aircraft Models

Use:

GLTF / GLB

V1 aircraft categories:

* Jumbo
* Widebody
* Narrowbody
* Regional
* GA
* Helicopter

Future:

Individual aircraft models

---

# Mode 3 - Chase Mode

User selects aircraft.

Camera attaches to aircraft.

Views:

Cockpit

Behind

Side

Underneath

Top

Hotkeys:

C

Cockpit

B

Behind

S

Side

U

Underneath

T

Top

---

# Performance Targets

Minimum:

32 FPS

Target:

60 FPS

Must support:

200+ aircraft

on consumer hardware.

Use:

* Frustum culling
* Instancing
* LOD

where beneficial.

---

# Time Controls

Required:

Live

Pause

Replay

Replay should preserve:

* Position history
* Trails
* Labels

Initial replay buffer:

15 minutes

Architecture should support future extension.

---

# Projector Mode

Dedicated mode.

Hotkey:

P

Behavior:

* Fullscreen
* Hide UI
* Hide cursor
* Optimize for ceiling viewing

This is expected to be the most common usage mode.

---

# Audio

Optional.

Local files only.

No streaming.

Suggested files:

/assets/audio/radar-ambience.mp3

/assets/audio/distant-jet.mp3

Features:

* Volume control
* Mute
* Independent channel toggles

---

# User Interface

Normal Mode:

* Aircraft list
* Search
* Filters
* Settings

Projector Mode:

Hide all UI.

Only sky visualization remains.

---

# Architecture

Frontend

* React
* TypeScript
* Three.js

Rendering

* WebGL
* GLTF models

Data

* ADS-B providers

State

* Zustand or equivalent

Build

* Vite

Deployment

* Local desktop
* Mini-PC
* Home server

---

# Future Enhancements

## Airport Models

* DFW
* Heathrow
* JFK
* Bangalore

---

## Weather Overlay

* Rain
* Clouds
* Storm cells
* Wind

---

## Historical Playback

Replay:

* Last hour
* Last day
* Custom dates

---

## AI Spotter

Examples:

"A380 detected"

"FedEx 767 entering airspace"

"Military aircraft detected"

Visual and optional audio notifications.

---

# Success Criteria

The application succeeds if a user can:

1. Project onto a ceiling.
2. Feel like they are looking through the roof.
3. Instantly distinguish different aircraft classes.
4. Recognize major airlines.
5. Watch realistic aircraft movement.
6. Follow aircraft in 3D.
7. Replay recent traffic.
8. Run entirely from free ADS-B data sources.
