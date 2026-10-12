"""DocuChat v2 UI: upload a PDF, watch it index, then chat + summarize -- grounded in the doc.

v2 additions: model provider picker (gpt4o / gpt4o-mini / opus / ollama),
thumbs up/down feedback on answers, usage stats tab.

Run:  streamlit run frontend/app.py
API base via env API_URL or .streamlit/secrets.toml (default http://localhost:8000).
"""
import os
import time

import requests
import streamlit as st

API = os.environ.get("API_URL", "http://localhost:8000")

st.set_page_config(page_title="DocuChat v2", layout="wide")
st.title("DocuChat v2 -- ask your documents")


def api(method, path, **kw):
    try:
        r = requests.request(method, f"{API}{path}", timeout=180, **kw)
        if r.status_code >= 400:
            st.error(f"API {r.status_code}: {r.text[:300]}")
            return None
        return r.json()
    except requests.ConnectionError:
        st.error(f"Can't reach the API at {API}. Is uvicorn running?")
        return None


def send_feedback(generation_id: str, kind: str):
    if generation_id:
        api("POST", f"/generations/{generation_id}/feedback", json={"kind": kind})


# ---------- sidebar: upload + document picker + model ----------
with st.sidebar:
    st.header("Documents")
    up = st.file_uploader("Upload a PDF", type=["pdf"])
    if up and st.button("Index document"):
        with st.spinner("Uploading..."):
            res = api("POST", "/documents/upload", files={"file": (up.name, up.getvalue())})
        if res:
            st.session_state["doc_id"] = res["document_id"]
            st.session_state["session_id"] = None
            st.rerun()

    docs = api("GET", "/documents") or []
    labels = {d["id"]: f"{d['filename']} ({d['status']})" for d in docs}
    if labels:
        sel = st.selectbox("Active document", list(labels.keys()),
                           format_func=lambda i: labels[i],
                           index=list(labels.keys()).index(st.session_state.get("doc_id"))
                           if st.session_state.get("doc_id") in labels else 0)
        st.session_state["doc_id"] = sel
        if st.button("Delete document"):
            api("DELETE", f"/documents/{sel}")
            st.session_state.pop("doc_id", None)
            st.session_state["session_id"] = None
            st.rerun()
    else:
        st.info("Upload a PDF to get started.")

    st.header("Answering model")
    provs = api("GET", "/providers") or {}
    options = provs.get("available", ["gpt4o-mini"])
    default = provs.get("default", "gpt4o-mini")
    st.session_state["provider"] = st.selectbox(
        "Provider", options,
        index=options.index(st.session_state.get("provider", default))
        if st.session_state.get("provider", default) in options else 0,
        help="Swap the answering LLM per question. Logged for the feedback flywheel.")

doc_id = st.session_state.get("doc_id")
if not doc_id:
    st.stop()

doc = next((d for d in docs if d["id"] == doc_id), None)

# ---------- ingestion progress ----------
if doc and doc["status"] != "ready":
    st.warning(f"Document status: **{doc['status']}** -- layout parsing in background...")
    if st.button("Refresh status"):
        st.rerun()
    time.sleep(3)
    st.rerun()

# ---------- main: chat + summary + stats ----------
tab_chat, tab_summary, tab_stats = st.tabs(["Chat", "Summary", "Usage stats"])

with tab_chat:
    sessions = api("GET", f"/documents/{doc_id}/sessions") or []
    sids = [s["id"] for s in sessions]
    if st.session_state.get("session_id") not in sids:
        st.session_state["session_id"] = sids[0] if sids else None
    col1, col2 = st.columns([3, 1])
    with col1:
        if sids:
            st.session_state["session_id"] = st.selectbox(
                "Conversation", sids,
                index=sids.index(st.session_state["session_id"]) if st.session_state["session_id"] in sids else 0,
                format_func=lambda s: s[:8])
    with col2:
        if st.button("New chat"):
            st.session_state["session_id"] = None
            st.rerun()

    sid = st.session_state.get("session_id")
    messages = api("GET", f"/sessions/{sid}/messages") if sid else []
    for m in messages or []:
        with st.chat_message(m["role"]):
            st.write(m["content"])
            if m["role"] == "assistant" and m.get("model"):
                st.caption(f"answered by {m['model']}")

    if prompt := st.chat_input("Ask about this document..."):
        with st.chat_message("user"):
            st.write(prompt)
        with st.spinner("Thinking..."):
            res = api("POST", f"/documents/{doc_id}/chat",
                      json={"question": prompt, "session_id": sid,
                            "provider": st.session_state.get("provider")})
        if res:
            st.session_state["session_id"] = res["session_id"]
            with st.chat_message("assistant"):
                st.write(res["answer"])
                st.caption(f"answered by {res.get('model', '?')}")
                if res.get("abstained"):
                    st.caption("The bot abstained -- no relevant info found in the document.")
                for c in res.get("citations", []):
                    label = f"p.{c['page']}" + (f" -- {c['section']}" if c.get("section") else "")
                    label += " [table]" if c.get("block_type") == "table" else ""
                    with st.expander(label):
                        st.write(c["snippet"])
                # feedback flywheel: every answer is ratable
                gid = res.get("generation_id")
                fb1, fb2, _ = st.columns([1, 1, 8])
                with fb1:
                    if st.button("👍", key=f"up_{gid}"):
                        send_feedback(gid, "thumbs_up")
                        st.toast("Thanks -- logged.")
                with fb2:
                    if st.button("👎", key=f"down_{gid}"):
                        send_feedback(gid, "thumbs_down")
                        st.toast("Logged -- we'll review this one.")
            st.rerun()

with tab_summary:
    if st.button("Generate summary"):
        with st.spinner("Summarizing (map-reduce over chunks)..."):
            res = api("POST", f"/documents/{doc_id}/summarize")
        if res:
            st.success("Cached summary" if res["cached"] else f"Fresh summary ({res.get('model', '?')})")
            st.write(res["summary"])
    elif doc and doc.get("status") == "ready":
        st.caption("Summaries are cached per document -- regenerating is free after the first run.")

with tab_stats:
    st.subheader("Usage by model (last 7 days)")
    stats = api("GET", "/stats/usage?days=7") or []
    if stats:
        st.dataframe([{
            "day": s["day"], "model": s["model"], "queries": s["generations"],
            "abstain %": round(s["abstain_rate"] * 100, 1),
            "bad feedback %": round(s["negative_feedback_rate"] * 100, 1),
            "avg latency ms": s["avg_latency_ms"],
        } for s in stats], use_container_width=True)
        st.caption("Bad feedback = thumbs-down + regenerate clicks. Watch it per model after swaps.")
    else:
        st.info("No generations logged yet -- chat first, stats appear here.")
