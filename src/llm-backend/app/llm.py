from typing import Dict, List

import httpx


PPQ_URL = "https://api.ppq.ai/chat/completions"


def get_headers(api_key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def build_messages(content: str, max_words: int) -> List[Dict[str, str]]:
    system_prompt = (
        "Explain the Bitcoin Improvement Proposal for non-technical readers. "
        "Keep it clear, concise, and under {} words. Avoid jargon where possible."
    ).format(max_words)
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


def build_qa_messages(content: str, question: str) -> List[Dict[str, str]]:
    system_prompt = (
        "Answer the user's question using the Bitcoin Improvement Proposal text. "
        "Explain in plain terms, be concise, and avoid speculation."
    )
    user_prompt = f"Question:\n{question}\n\nBIP Content:\n{content}"
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def request_summary(content: str, model: str, max_words: int, api_key: str) -> str:
    payload = {
        "model": model,
        "messages": build_messages(content, max_words),
        "temperature": 0.2,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(PPQ_URL, headers=get_headers(api_key), json=payload)
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def request_answer(content: str, question: str, model: str, api_key: str) -> str:
    payload = {
        "model": model,
        "messages": build_qa_messages(content, question),
        "temperature": 0.2,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(PPQ_URL, headers=get_headers(api_key), json=payload)
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def trim_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words])
