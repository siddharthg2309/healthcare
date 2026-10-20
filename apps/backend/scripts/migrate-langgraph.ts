import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "@healthcare/database";

const checkpointer = new PostgresSaver(pool, undefined, { schema: "langgraph" });

try {
  await checkpointer.setup();
  console.log("LangGraph checkpoint schema is ready.");
} catch {
  console.error("Could not prepare the LangGraph checkpoint schema.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
