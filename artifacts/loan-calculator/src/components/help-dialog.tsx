import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { HelpCircle, Search, ArrowLeft, ChevronRight, MapPin, BookOpen, SearchX } from "lucide-react";
import { HELP_TOPICS, getTopic, getDefaultTopicId, searchTopics, type HelpTopic } from "@/lib/help-content";

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.join("|")})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function HelpDialog() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTopic = activeId ? getTopic(activeId) : undefined;
  const results = useMemo(() => searchTopics(query), [query]);
  const searching = query.trim().length > 0;

  const openHelp = () => {
    setQuery("");
    setActiveId(getDefaultTopicId(location));
    setOpen(true);
  };

  const selectTopic = (id: string) => {
    setActiveId(id);
    setQuery("");
  };

  const renderTopicList = (topics: HelpTopic[]) => (
    <div className="space-y-1.5">
      {topics.map((topic) => (
        <button
          key={topic.id}
          onClick={() => selectTopic(topic.id)}
          className="w-full text-left rounded-lg border bg-background p-3 hover:border-primary/40 hover:bg-muted/40 transition-colors group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm">{highlight(topic.title, query)}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground flex-shrink-0" />
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {highlight(topic.body[0], query)}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1.5 inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {topic.screen}
          </p>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={openHelp} aria-label="Help">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Help & how-to guide</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 space-y-2">
            <DialogTitle className="font-display flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Help
            </DialogTitle>
            <DialogDescription>
              Learn how this application works, screen by screen. Search or browse the topics below.
            </DialogDescription>
            <div className="relative pt-1">
              <Search className="absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help topics…"
                className="pl-9"
              />
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 pb-6 pt-1">
              {searching ? (
                results.length > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      {results.length} topic{results.length !== 1 ? "s" : ""} match{results.length === 1 ? "es" : ""} “{query.trim()}”
                    </p>
                    {renderTopicList(results)}
                  </>
                ) : (
                  <div className="text-center py-10 space-y-2">
                    <SearchX className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="text-sm font-medium">No topics match “{query.trim()}”</p>
                    <p className="text-xs text-muted-foreground">
                      Try a different keyword, or browse all topics by clearing the search.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                  </div>
                )
              ) : activeTopic ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <button
                      onClick={() => setActiveId(null)}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors font-medium"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      All topics
                    </button>
                    <span className="text-border">/</span>
                    <span className="text-foreground font-medium">{activeTopic.title}</span>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-display font-semibold">{activeTopic.title}</h3>
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <MapPin className="h-3 w-3" />
                      Applies to: {activeTopic.screen}
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {activeTopic.body.map((para, i) => (
                      <p key={i} className="text-sm leading-relaxed text-foreground/90">
                        {para}
                      </p>
                    ))}
                  </div>
                  {activeTopic.related.length > 0 && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Related topics
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {activeTopic.related.map((id) => {
                          const rel = getTopic(id);
                          if (!rel) return null;
                          return (
                            <Button
                              key={id}
                              variant="outline"
                              size="sm"
                              className="gap-1.5 h-7 text-xs"
                              onClick={() => selectTopic(id)}
                            >
                              {rel.title}
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                renderTopicList(HELP_TOPICS)
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
