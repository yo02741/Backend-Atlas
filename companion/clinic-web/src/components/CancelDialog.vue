<script setup>
// 取消前的確認視窗（第 4 階段）
import { useTemplateRef } from 'vue'

const props = defineProps({ appointment: { type: Object, default: null } })
const emit = defineEmits(['confirm'])
const dialog = useTemplateRef('dialog')

function open() {
  dialog.value.returnValue = ''        // Esc 關閉時不會設定 returnValue：先清掉上一次的值
  dialog.value.showModal()             // 背景 inert、焦點移到有 autofocus 的「保留掛號」
}
function onClose() {
  if (dialog.value.returnValue === 'confirm') emit('confirm', props.appointment)
  // 「保留掛號」或 Esc：什麼都不做，瀏覽器把焦點還給開啟前的「取消掛號」
}
defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc" @close="onClose">
    <h2 id="cancel-title">取消第 {{ appointment?.number }} 號的掛號？</h2>
    <p id="cancel-desc">取消後名額會開放給其他人，無法復原。</p>
    <form method="dialog">
      <button value="keep" autofocus>保留掛號</button>
      <button value="confirm" class="danger">確定取消</button>
    </form>
  </dialog>
</template>

<style scoped>
dialog:modal { overscroll-behavior: contain; }                 /* 在視窗裡捲動不帶動後面的頁面 */
dialog::backdrop { background: rgb(0 0 0 / 0.5); overflow: hidden; overscroll-behavior: contain; }
</style>
