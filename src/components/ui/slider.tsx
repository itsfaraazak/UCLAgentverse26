import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

// Local amendment to the generated primitive (SPEC §5: labelled controls).
// Base UI puts role="slider" on the nested input inside Slider.Thumb, and that
// input takes its accessible name from the Thumb's own aria-label — not from
// anything passed to Slider.Root, which renders a role="group" div. Without a
// way to reach the thumb, the control is announced unnamed. `thumbProps`
// forwards aria-* down to each thumb; nothing else about the primitive changes.
type SliderProps = SliderPrimitive.Root.Props & {
  thumbProps?: Pick<
    SliderPrimitive.Thumb.Props,
    "aria-label" | "aria-labelledby" | "aria-valuetext" | "getAriaValueText"
  >
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbProps,
  ...props
}: SliderProps) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
            {...thumbProps}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
