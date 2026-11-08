/*
 * DeltaGene physical sign-off gate.
 *
 * Target: Arduino Uno Q (primary). Also runs unmodified on an ESP32 dev
 * board from the kit -- it only uses standard digitalWrite/digitalRead/
 * Serial calls, no board-specific libraries.
 *
 * Behaviour:
 *   - Red LED on, green LED off   => a variant classification is
 *     BLOCKED pending human review (host sent "ARM:<reason>").
 *   - Green LED on, red LED off   => approved / idle (host sent
 *     "CLEAR", or the button was pressed while armed).
 *   - Pressing the button while armed sends "BUTTON:PRESSED" back to
 *     the host over serial and clears locally too, so the board's
 *     own LEDs always agree with what the host believes happened even
 *     if a serial byte gets lost.
 *
 * Wire protocol, 115200 baud, newline-terminated ASCII. See
 * deltagene/hardware/gate_bridge.py for the host side.
 */

#define LED_RED_PIN 9     // blocked / needs sign-off
#define LED_GREEN_PIN 10  // approved / idle
#define BUTTON_PIN 2      // wired to GND, uses internal pull-up

const unsigned long DEBOUNCE_MS = 40;

bool armed = false;
int lastButtonReading = HIGH;
int debouncedButtonState = HIGH;
unsigned long lastBounceAt = 0;

String serialBuffer;

void setState(bool isArmed) {
  armed = isArmed;
  digitalWrite(LED_RED_PIN, armed ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, armed ? LOW : HIGH);
}

void setup() {
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  setState(false);  // boot into approved/idle, not blocked
}

void handleLine(const String &line) {
  if (line.startsWith("ARM:")) {
    setState(true);
    // Reason text itself isn't echoed back; the host already knows it.
  } else if (line == "CLEAR") {
    setState(false);
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        handleLine(serialBuffer);
      }
      serialBuffer = "";
    } else if (c != '\r') {
      serialBuffer += c;
    }
  }
}

void pollButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastBounceAt = millis();
  }

  if ((millis() - lastBounceAt) > DEBOUNCE_MS) {
    if (reading != debouncedButtonState) {
      debouncedButtonState = reading;
      // INPUT_PULLUP: pressed == LOW
      if (debouncedButtonState == LOW && armed) {
        Serial.println("BUTTON:PRESSED");
        setState(false);
      }
    }
  }

  lastButtonReading = reading;
}

void loop() {
  pollSerial();
  pollButton();
}
