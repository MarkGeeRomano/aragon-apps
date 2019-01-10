import React from 'react'
import styled from 'styled-components'

const StyledButton = styled.button`
  border: none;
  background: none;
  height: 2.5em;
  width: 2.5em;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
`

export default props => (
  <StyledButton {...props}>
    <svg width="24px" height="24px" viewBox="0 0 24 24" {...props}>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
      <path d="M0 0h24v24H0z" fill="none" />
    </svg>
  </StyledButton>
)
