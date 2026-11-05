# Results: Challenge 6, part 2: call the registry API

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker push 127.0.0.1:52802/dkr-c6/hello:1   and   :2
```

**Output**

```text
tag 1 -> sha256:c64a56b392f4c5f8bb6b7ae408b2665e3d9da37ed83c5ec63610cee05fbedd09
tag 2 -> sha256:e06fdd256bdad03fd455ac23beee90dc316230fc16eca49ce6dfd59e8eee80d4
sha256 of the manifest bytes of tag 1: sha256:c64a56b392f4c5f8bb6b7ae408b2665e3d9da37ed83c5ec63610cee05fbedd09
```

**Note:** A digest is the SHA-256 of the manifest bytes. The registry and the hash agree.

## Step 2

**Command**

```sh
node -e "import('./client.mjs')..."  (ping, catalog, tags, digestOf, manifest, packedBytes)
```

**Output**

```text
ok   ping()                         {"status":200,"apiVersion":"registry/2.0"}
ok   catalog()                      ["dkr-c6/hello"]
ok   tags('dkr-c6/hello')           ["1","2"]
ok   digestOf(..., '1')             c64a56b392f4
ok   manifest(..., '1')             {"status":200,"digest":"c64a56b392f4","layers":2}
ok   packedBytes(..., '1')          3853213
```

**Note:** Every call matches what the registry holds.

## Step 3

**Command**

```sh
docker pull 127.0.0.1:52802/dkr-c6/hello:3   (this machine already holds every layer)
```

**Output**

```text
HEAD  /v2/dkr-c6/hello/manifests/3 200
```

**Note:** 1 request(s). Docker asks the registry which digest the tag has, sees it holds all the blobs, and downloads nothing.

## Step 4

**Command**

```sh
a fresh machine pulls tag 3: ping, manifest, config blob, each layer (read from the registry log)
```

**Output**

```text
GET   /v2/ 200
GET   /v2/dkr-c6/hello/manifests/3 200
GET   /v2/dkr-c6/hello/blobs/sha256:f220b671... 200
GET   /v2/dkr-c6/hello/blobs/sha256:5e9b4a97... 200
GET   /v2/dkr-c6/hello/blobs/sha256:650de554... 200
GET   /v2/dkr-c6/hello/blobs/sha256:3139008f... 200
downloaded 4.85 MB in 142 ms
```

**Note:** A full pull is 6 requests: 1 ping, 1 manifest, 4 blob (the config and 3 layers). There is no token step because this registry has no login.

## Step 5

**Command**

```sh
DELETE /v2/dkr-c6/hello/manifests/<digest>   then   registry garbage-collect
```

**Output**

```text
delete status: 202   (202 means accepted)
tag 2 gone from the tag list: true
storage before 7076 KB, after delete 7044 KB, after garbage collection 5048 KB
8 blobs marked, 4 blobs and 0 manifests eligible for deletion
blob eligible for deletion: sha256:e06fdd256bdad03fd455ac23beee90dc316230fc16eca49ce6dfd59e8eee80d4
blob eligible for deletion: sha256:241ad207ee0456c3f1f4e6cbdf2905eeae079781576160cb73f0ab8df9f5bf74
blob eligible for deletion: sha256:989ddba3897f2e5ba8f00c54740c4f1bae8447a82ddeae93310b4d89504cd698
```

**Note:** Deleting removes the reference only. The bytes go when garbage collection runs.
