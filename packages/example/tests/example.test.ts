import { hello } from "../index";

if (hello("world") !== "hello, world") {
  throw new Error("hello() should greet through the entry point");
}
