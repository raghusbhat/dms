import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import type { Matcher } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Parses "YYYY-MM-DD" as local time (avoids UTC off-by-one in non-UTC timezones)
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDisplay(iso: string): string {
  const d = parseLocalDate(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface DatePickerProps {
  value: string;                      // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: Matcher | Matcher[];     // react-day-picker disabled matchers
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 justify-start text-left font-normal shadow-none",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
          {value ? formatDisplay(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? parseLocalDate(value) : undefined}
          onSelect={(date) => {
            if (date) {
              // Store as local YYYY-MM-DD
              const iso = [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0"),
              ].join("-");
              onChange(iso);
            } else {
              onChange("");
            }
            setOpen(false);
          }}
          disabled={disabled}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
