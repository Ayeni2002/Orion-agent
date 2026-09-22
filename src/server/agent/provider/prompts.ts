import type { ModelOperation } from "./provider";

/**
 * What the model is being asked to do, in its own terms.
 *
 * **Why this is its own module.** It began life private to
 * `openai-provider.ts`, which was right while one adapter existed. The Gemini
 * adapter needs the same six prompts, and copying them would have created two
 * copies that drift *invisibly*: a changed sentence in a system prompt is a
 * change in the quality of a plan or an evaluation, not a compile error and not
 * a failing test, so nothing would report it. The two adapters would quietly
 * stop asking the same question. Sharing one definition is the only version of
 * this that cannot happen.
 *
 * It also keeps a promise `openai-provider.ts` already made in a comment: that
 * prompts are kept apart from transport so that swapping the transport does not
 * mean rewriting prompts, and swapping a prompt does not mean touching the
 * transport. A module the transports import from states that separation in the
 * file tree rather than only in prose.
 *
 * Nothing here varies by provider. That is the test for whether something
 * belongs in this file: if a future adapter needed different wording for one of
 * these operations, the honest change would be to say why, not to fork it
 * silently.
 */
export function describeOperation(operation: ModelOperation): string {
  switch (operation) {
    case "plan":
      return (
        "You are the planning component of Orion, a research agent. " +
        "Decompose the objective you are given into an ordered list of concrete " +
        "steps. Reply with JSON only, and invent no facts about the subject."
      );

    case "execute_step":
      return (
        "You are the execution component of Orion, a research agent. " +
        "Carry out the single step you are given using only the context " +
        "provided. Do not claim to have retrieved anything you were not given."
      );

    case "evaluate":
      return (
        "You are the evaluation component of Orion, a research agent. " +
        "Assess what the run actually produced and state plainly what could not " +
        "be established. Reply with JSON only."
      );

    case "research_plan":
      return (
        "You are the research planning component of Orion. Break the research " +
        "question you are given into the distinct things that must be " +
        "established to answer it, and for each one give the search query most " +
        "likely to find sources that establish it. Reply with JSON only. Do not " +
        "answer the question yourself and do not state any fact about it."
      );

    case "report":
      return (
        "You are the reporting component of Orion. You are given the findings a " +
        "research run recorded, each numbered, and you write the readable parts " +
        "of a report about them: an executive summary, an analysis organised " +
        "into sections, and suggested next steps. Reply with JSON only. " +
        "Refer to findings by their number — never by title, and never with a " +
        "URL, a source name or a quotation of your own. You have no other " +
        "material. State nothing the numbered findings do not already say, " +
        "introduce no number that is not in them, and where they leave a " +
        "question open, say that it is open rather than answering it."
      );

    case "research_findings":
      return (
        "You are the finding extraction component of Orion. You are given a " +
        "research question and the text of sources retrieved for it. State only " +
        "what those sources actually say, and support every claim with a verbatim " +
        "quote from the source you cite. If the sources do not establish " +
        "something, say so rather than filling the gap. Reply with JSON only. " +
        "Never state a fact that is not present in the sources you were given."
      );
  }
}
