import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type ProfileResponse = {
  profile?: { static?: string[]; dynamic?: string[] };
};

export default defineTool({
  description:
    "Get the user's profile: stable long-term facts plus what's going on right now. Cheap and fast — good first call.",
  inputSchema: z.object({
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  async execute({ space }) {
    const res = await sm<ProfileResponse>("/v4/profile", {
      containerTag: spaceTag(space),
    });
    return {
      stableFacts: res.profile?.static ?? [],
      rightNow: res.profile?.dynamic ?? [],
    };
  },
});
