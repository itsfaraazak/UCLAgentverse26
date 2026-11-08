# Physical sign-off gate — wiring & flashing

This is the one piece of hardware in DeltaGene: a red/green LED pair and a
push-button that make the compliance agent's human-sign-off requirement a
real, physical action a judge can watch happen. **It is optional.** If you
don't get it wired up in time, `deltagene/hardware/gate_simulator.py` takes
over automatically and the whole pipeline still runs end to end — the board
is a bonus demo prop, not a dependency.

## Parts (all in the kit)

- 1x Arduino Uno Q **or** 1x ESP32 dev board (either works, same sketch)
- 1x red LED, 1x green LED
- 2x resistors, ~220–330 ohm (current limiters for the LEDs)
- 1x push-button
- Breadboard + jumper wires

## Wiring

Match these to the `#define`s at the top of `firmware/sign_off_gate.ino`
(`LED_RED_PIN 9`, `LED_GREEN_PIN 10`, `BUTTON_PIN 2`) — renumber both the
`#define`s and the wiring together if those pins are already in use on
your board.

1. **Red LED**: board pin 9 → resistor → LED long leg (anode) → LED short
   leg (cathode) → breadboard ground rail → board GND.
2. **Green LED**: board pin 10 → resistor → LED long leg (anode) → LED
   short leg (cathode) → ground rail → board GND. (Same ground rail as
   the red LED is fine.)
3. **Button**: one leg → board pin 2, the other leg → board GND. Nothing
   else needed — the sketch enables the internal pull-up resistor
   (`INPUT_PULLUP`), so the pin reads HIGH normally and LOW when pressed.

## Flashing

1. Install the Arduino IDE (or use the one already set up for the
   hackathon) and open `sign_off_gate.ino`.
2. **Board**: select "Arduino Uno Q" from Tools → Board if using that
   board; if using an ESP32 dev board instead, select the matching ESP32
   board entry (e.g. "ESP32 Dev Module") — the sketch doesn't change.
3. **Port**: Tools → Port, pick the `/dev/ttyACM*`, `/dev/ttyUSB*` (Linux)
   or `COM*` (Windows) entry that appears when the board is plugged in.
4. Click Upload.

## Checking it worked

1. Open the Serial Monitor at **115200 baud**.
2. Type `ARM:test` and send it → the red LED should turn on, green off.
3. Press the physical button → the Serial Monitor should print
   `BUTTON:PRESSED`, and the green LED should turn on, red off.
4. Type `CLEAR` and send it → green stays on, red stays off (this is
   what the compliance agent sends once a human has already approved
   through the gate, or to reset to idle).

Once that works, `deltagene.hardware.get_gate()` will find the board
automatically over USB serial — no code changes needed, no port number
to hardcode anywhere in the Python side.
