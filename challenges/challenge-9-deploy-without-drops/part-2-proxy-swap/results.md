# Results: Challenge 9, part 2: swap two copies behind a proxy

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
swap.json: { "healthGate": false, "drainMs": 0 }   (start green, point nginx at it at once, stop blue at once; median of 3)
```

**Output**

```text
requests: 261   failed: 118   (502/503 from the proxy 118, refused 0, reset 0, timeout 0)
swap took 3.5 s; answers from version 1: 61, from version 2: 8
```

**Note:** nginx was pointed at green before green was listening, so some requests got a 502 from the proxy. The careless swap drops requests even though both copies are healthy.

## Step 2

**Command**

```sh
swap.json: {"healthGate":true,"drainMs":1500}   (median of 3)
```

**Output**

```text
requests: 380   failed: 0   (502/503 from the proxy 0, refused 0, reset 0, timeout 0)
swap took 9.4 s; answers from version 1: 87, from version 2: 103
```

**Note:** Not one request failed. Green was checked first (/ready answers only once it listens, 4 s after it starts), nginx was reloaded gracefully, and blue got 1500 ms to finish what it was doing before it was stopped. Both versions served traffic, so the swap really happened.
