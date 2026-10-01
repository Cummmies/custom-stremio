#!/usr/bin/env python3
"""Copies a .wasm file without one custom section.

    strip-wasm-section.py in.wasm out.wasm target_features

Used by build-core-tv.sh: Rust's prebuilt standard library marks
reference-types in the target_features section, which makes wasm-bindgen use
externref even when the crate was built without it.
"""
import sys
def leb(b,i):
    n=s=0
    while True:
        x=b[i]; i+=1; n|=(x&127)<<s; s+=7
        if not x&128: return n,i
src,dst,name=sys.argv[1],sys.argv[2],sys.argv[3]
b=open(src,'rb').read(); out=bytearray(b[:8]); i=8
while i<len(b):
    start=i; sid=b[i]; i+=1; size,i=leb(b,i); end=i+size
    if sid==0:
        l,j=leb(b,i)
        if b[j:j+l].decode()==name: i=end; print('removed',name); continue
    out+=b[start:end]; i=end
open(dst,'wb').write(out)
