import * as ReactMod from 'react'
import * as ReactDOM from 'react-dom'

var React = ReactMod.createElement ? ReactMod : ReactMod.default
var h = React.createElement, Fragment = React.Fragment
// Optional DSH syntax service: plain text remains usable when it is absent.
var codePrimitives = null
try { codePrimitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch (error) {}
var RPC_ENDPOINT = 'git', RPC_CHANNEL = '/api', NS = 'gitPlugin'

export { Fragment, NS, RPC_CHANNEL, RPC_ENDPOINT, React, ReactDOM, codePrimitives, h }
