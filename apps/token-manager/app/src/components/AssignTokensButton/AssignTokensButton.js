import React from 'react'
import styled from 'styled-components'
import { theme } from '@aragon/ui'
import Icon from './Icon'

const StyledButton = styled.button`
  border: none;
  background: none;
  height: 24px;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;

  &:focus {
    border: 2px solid ${theme.accent};
  }

  &:active {
    border: none;
  }
`

export default props => (
  <StyledButton {...props}>
    <Icon />
  </StyledButton>
)
