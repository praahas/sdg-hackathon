import React from 'react'

export default function PoweredBy({ className = '' }) {
  return (
    <footer className={`powered-by ${className}`}>
      Powered by{' '}
      <a href="https://flashflowtech.com" target="_blank" rel="noopener noreferrer">
        Flashflow<sup>®</sup> Technologies OPC Private Limited
      </a>
    </footer>
  )
}
