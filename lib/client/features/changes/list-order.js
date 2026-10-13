import { React } from '../../core/runtime.js'

const LIST_TRANSFER = 'application/x-dshgit-changelist'

/** List ordering has its own drag type; file drops retain their existing handlers. */
export function useChangelistOrder(props) {
  var model = props.changelists, root = props.repo?.root
  var source = React.useRef(null), marker = React.useState(null)
  var blocked = props.busy || model.loading || model.pending
  var exists = function (id) { return model.data?.lists.some(function (list) { return list.id === id }) }
  var reset = function () { source.current = null; marker[1](null) }
  var isList = function (event) { return Array.from(event.dataTransfer?.types || []).includes(LIST_TRANSFER) }
  var position = function (event) {
    var rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  return {
    handle: function (id) {
      if (!exists(id)) return {}
      return { draggable: !blocked, 'aria-description': props.t('cl.reorder'),
        onDragStart: function (event) {
          if (blocked) { event.preventDefault(); return }
          event.stopPropagation()
          source.current = id
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(LIST_TRANSFER, JSON.stringify({ root: root, id: id }))
        }, onDragEnd: reset,
      }
    },
    header: function (id, fileDrop) {
      if (!exists(id)) return fileDrop
      return Object.assign({}, fileDrop, {
        'data-reorder-position': marker[0]?.id === id ? marker[0].position : undefined,
        onDragOver: function (event) {
          if (!isList(event)) { fileDrop.onDragOver?.(event); return }
          if (blocked || source.current === id) return
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
          var edge = position(event)
          marker[1](function (current) { return current?.id === id && current.position === edge ? current : { id: id, position: edge } })
        },
        onDragLeave: function (event) {
          if (!isList(event)) { fileDrop.onDragLeave?.(event); return }
          if (!event.currentTarget.contains(event.relatedTarget)) marker[1](null)
        },
        onDrop: function (event) {
          if (!isList(event)) { fileDrop.onDrop?.(event); return }
          event.preventDefault(); event.stopPropagation()
          var edge = position(event)
          reset()
          if (blocked) return
          try {
            var transfer = JSON.parse(event.dataTransfer.getData(LIST_TRANSFER))
            if (transfer.root !== root || !exists(transfer.id) || transfer.id === id) return
            model.mutate({ action: 'reorder', id: transfer.id, target: id, position: edge }).catch(function () {})
          } catch (error) {}
        },
      })
    },
  }
}
