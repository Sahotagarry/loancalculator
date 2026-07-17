import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useListCounterparties } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CURATED_COUNTERPARTIES } from "@/lib/counterparties";

interface CounterpartyComboboxProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
}

interface Option {
  name: string;
  category: string;
}

export function CounterpartyCombobox({
  value,
  onChange,
  placeholder = "Select or type a counterparty…",
  id,
}: CounterpartyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: usedCounterparties } = useListCounterparties();

  const options = useMemo<Option[]>(() => {
    const byName = new Map<string, Option>();
    for (const c of CURATED_COUNTERPARTIES) {
      byName.set(c.name.toLowerCase(), { name: c.name, category: c.category });
    }
    for (const name of usedCounterparties ?? []) {
      const key = name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, { name, category: "Previously used" });
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [usedCounterparties]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Option[]>();
    for (const opt of options) {
      const list = groups.get(opt.category) ?? [];
      list.push(opt);
      groups.set(opt.category, list);
    }
    return Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [options]);

  const trimmedSearch = search.trim();
  const exactMatch = options.some(
    (o) => o.name.toLowerCase() === trimmedSearch.toLowerCase(),
  );

  const select = (name: string | null) => {
    onChange(name);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command
          filter={(itemValue, searchValue) =>
            itemValue.toLowerCase().includes(searchValue.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="Search counterparty…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No counterparty found.</CommandEmpty>
            {trimmedSearch && !exactMatch && (
              <CommandGroup heading="Add new">
                <CommandItem
                  value={`__add__${trimmedSearch}`}
                  onSelect={() => select(trimmedSearch)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Use "{trimmedSearch}"
                </CommandItem>
              </CommandGroup>
            )}
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => select(null)}
                  className="text-muted-foreground"
                >
                  Clear selection
                </CommandItem>
              </CommandGroup>
            )}
            {grouped.map(([category, opts]) => (
              <CommandGroup key={category} heading={category}>
                {opts.map((opt) => (
                  <CommandItem
                    key={opt.name}
                    value={opt.name}
                    onSelect={() => select(opt.name)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === opt.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {opt.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
