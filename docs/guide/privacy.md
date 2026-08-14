# A word on privacy

[← README](../../README.md) · [Guide index](index.md)

Party codes are six characters from a 32-symbol alphabet — short enough to read aloud in
a queue, and short enough to guess. The party key is not the code: it is 256 random bits
minted when the party starts, and it reaches the other phones inside the QR code or the
invite link's fragment, which browsers never send to a server. A phone joining by typed
code cannot be handed 256 bits by hand, so it asks the host for them once, over a single
exchange sealed with a key derived from the code — the only frame in a party's life a
guessed code can open, and only while the host is still answering. Treat a party as a
semi-public channel anyway, because a code given to the wrong person is an invitation: use
first names, and leave when you're done, which deletes your record from the server. Nothing
is sent anywhere until you actually join a party; before that your position stays in the
browser.

---
[← README](../../README.md) · [Guide index](index.md)
