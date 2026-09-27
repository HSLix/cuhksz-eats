let contentPromise

export function loadContent() {
  if (!contentPromise) {
    contentPromise = fetch(`${import.meta.env.BASE_URL}content.json`).then((response) => {
      if (!response.ok) throw new Error('无法加载本地内容')
      return response.json()
    })
  }
  return contentPromise
}

export function previewNote(note) {
  const characters = Array.from(note)
  return characters.slice(0, 6).join('') + (characters.length > 6 ? '…' : '')
}
