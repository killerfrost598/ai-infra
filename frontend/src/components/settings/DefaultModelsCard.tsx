"use client";

import { useState, useEffect } from "react";
import { useSettings, useSaveSetting, useDeleteSetting, useSeedDefaultModels } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function DefaultModelsCard() {
  const { data } = useSettings();
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const seedDefaults = useSeedDefaultModels();

  const entry = data?.settings.find((s) => s.key === "default_seed_models");
  const currentValue = entry?.value ?? "";
  const isConfigured = entry?.is_configured ?? false;

  const [input, setInput] = useState(currentValue);

  useEffect(() => {
    setInput(currentValue);
  }, [currentValue]);

  function handleSave() {
    const value = input.trim();
    if (!value) return;
    saveSetting.mutate({ key: "default_seed_models", value });
  }

  function handleClear() {
    deleteSetting.mutate("default_seed_models", {
      onSuccess: () => setInput(""),
    });
  }

  return (
    <Card id="default-models" className="px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Default Models</p>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            HuggingFace repo IDs to seed on first use. One per line (e.g.{" "}
            <code className="text-foreground/70">meta-llama/Llama-3.1-8B-Instruct</code>). After
            saving, click &ldquo;Seed defaults now&rdquo; to kick off background tasks.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isConfigured && (
            <>
              <Button
                size="sm"
                variant="outline"
                loading={seedDefaults.isPending}
                onClick={() => seedDefaults.mutate()}
              >
                Seed defaults now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={deleteSetting.isPending}
                onClick={handleClear}
              >
                Clear
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <textarea
          className="input flex-1 resize-none font-mono text-xs"
          rows={5}
          placeholder={"meta-llama/Llama-3.1-8B-Instruct\nmistralai/Mistral-7B-Instruct-v0.3\nQwen/Qwen2.5-7B-Instruct"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button
          onClick={handleSave}
          loading={saveSetting.isPending}
          disabled={!input.trim() || input.trim() === currentValue}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
