import { eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";

// Recall is local-first by design: the agent only ever serves localhost.
export default eveChannel({
  auth: [localDev()],
});
