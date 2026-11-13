import { createFileRoute } from "@tanstack/react-router";
import { WordsGuess } from "@/components/words-guess";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WordsGuess />;
}
