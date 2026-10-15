# Deepcore — Controls

This file defines the actions the game is driven by, the keys bound to them, what
each does on each screen, and the pointer and touch input the menus, the panels,
and the status bar take. Every action name and key below carries the name this
specification gives it.

Input belongs to the Simple 2D engine. The game registers each action below
by name against the codes bound to it, and the engine reports whether the action
is held and whether it went down this frame. Actions are read anywhere in the
game's update. The engine also reports the pointer's position in the stage's
logical units along with its press and release edges and the contacts currently
down, and a mouse, a pen, and a finger all arrive on those same reads.

## The actions

`ACTIONS` binds each action name to the `KeyboardEvent.code` values that drive it.

| Action | Codes |
| --- | --- |
| `left` | `KeyA`, `ArrowLeft` |
| `right` | `KeyD`, `ArrowRight` |
| `down` | `KeyS`, `ArrowDown` |
| `up` | `KeyW`, `ArrowUp`, `Space` |
| `activate` | `KeyE`, `Enter` |
| `inventory` | `KeyI` |
| `pause` | `Escape`, `KeyP` |
| `mute` | `KeyM` |
| `jettison` | `KeyJ` |
| `supply1` through `supply6` | `Digit1` through `Digit6` |

## In the mine

Movement is continuous: an action drives the miner for as long as it is held.

| Action | Effect |
| --- | --- |
| `left`, `right` | Walk that way. Once the miner's box is flush against a minable cell on that side and the miner is grounded, cut into it and then move into the tunnel it leaves. |
| `down` | While grounded, cut the cell below and sink into it. With open space below, nothing; the miner simply falls. |
| `up` | Fire the jetpack. |
| `activate` | At a surface building, open its panel, or save at the Save Pad. |
| `inventory` | Open and close the inventory overlay. |
| `pause` | Open the pause menu, or close an open panel. |
| `mute` | Toggle all audio. |
| `jettison` | Drop a carried Core Sample onto the miner's cell. |
| `supply1` through `supply6` | Use the field supply of that number. |

The miner faces the direction of the last `left` or `right` held, and its sprite
mirrors to match.

## On a menu screen

| Action | Effect |
| --- | --- |
| `up`, `down` | Move the highlighted item up and down, wrapping at the ends. |
| `activate` | Choose the highlighted item. |
| `pause` | Go back, where the screen has a back, and resume the expedition on `paused`. |

`specs/ui.md` states which screen each choice and each way back reaches, and
which entry is highlighted on arrival.

## With the pointer and touch

Every menu item, panel control, and status-bar control occupies a rectangular hit
region, laid out wherever the build draws it. `specs/instrumentation.md` states
the readings the build reports those regions through, in the stage's logical
units, so the layout stays the build's own.

| Input | Effect |
| --- | --- |
| A pointer moves onto a menu item's region | That item becomes the highlighted item, the one `menuIndex` reports. |
| A pointer is pressed and released inside one menu item's region | That item becomes the highlighted item and is chosen, exactly as `activate` chooses it. |
| A touch contact lands inside a menu item's region, or travels onto one | That item becomes the highlighted item. |
| A touch contact lands and lifts inside one menu item's region | That item becomes the highlighted item and is chosen. |
| A pointer pressed and released, or a touch contact landed and lifted, inside one panel or status-bar control's region | That control acts, exactly as its keyboard route does. |

A choice requires both of its edges inside one region: the press and its release for
a pointer, the landing and the lift for a touch contact. Two edges falling in
different regions, and an edge falling outside every region, choose nothing.

Pressing a surface building activates it, exactly as `activate` does while
standing at it. The first-time hazard notice card is dismissed by a press on it.

A control is drawn as operable only where it acts. Where the game cannot act on a
control in the state it is in, that control is drawn disabled or is not drawn at
all, and it neither highlights under the pointer nor answers a press.

The game is fully playable with the keyboard for movement, drilling, and thrust,
and with a pointer or a touch screen for the panels and menus. No control beyond
those listed here is required.
