import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, useDayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 11 }, (_, i) => THIS_YEAR - 5 + i);

function CaptionWithNav({ calendarMonth }: { calendarMonth: { date: Date } }) {
  const { goToMonth, previousMonth, nextMonth } = useDayPicker();
  const d = calendarMonth.date;

  const handleMonth = (val: string) => goToMonth(new Date(d.getFullYear(), parseInt(val), 1));
  const handleYear  = (val: string) => goToMonth(new Date(parseInt(val), d.getMonth(), 1));

  return (
    <div className="flex items-center justify-between w-full h-8 px-1">
      <button
        onClick={() => previousMonth && goToMonth(previousMonth)}
        disabled={!previousMonth}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 opacity-50 hover:opacity-100 disabled:opacity-30"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-1">
        <Select value={String(d.getMonth())} onValueChange={handleMonth}>
          <SelectTrigger className="h-7 w-28 text-xs border-none shadow-none font-medium focus:ring-0 px-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i)} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(d.getFullYear())} onValueChange={handleYear}>
          <SelectTrigger className="h-7 w-16 text-xs border-none shadow-none font-medium focus:ring-0 px-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <button
        onClick={() => nextMonth && goToMonth(nextMonth)}
        disabled={!nextMonth}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 opacity-50 hover:opacity-100 disabled:opacity-30"
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex items-center",
        caption_label: "hidden",
        nav: "hidden",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        range_end: "day-range-end",
        selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-primary/20 text-primary font-semibold",
        outside: "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        MonthCaption: CaptionWithNav,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
